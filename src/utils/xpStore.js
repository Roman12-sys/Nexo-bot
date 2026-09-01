// Sistema de XP/niveles. Completamente separado de economy y trivia: ninguna función
// de acá toca esas tablas ni ellas tocan esta.
//
// MIGRADO A SUPABASE (antes: xp.json). Toda función que antes era síncrona (leía el
// archivo en el mismo tick) ahora es async porque implica una llamada de red a Postgres.
// Cualquier caller tiene que hacer `await`. La curva de niveles (xpRequiredForLevel,
// getLevelProgress, totalXpForLevel) sigue siendo pura/sync — no hace I/O, no cambia.
import { supabase } from '../supabaseClient.js';
import { eventBus } from './eventBus.js'; // Event Engine — auditoría 2026-08-29, Parte 7/Fase 3
import { resolveXpOrigin } from './economyOrigins.js'; // Fase A, segunda auditoría (2026-08-30)
import { withLock } from './asyncLock.js'; // Fase 2A (2026-08-31) — ver grantMessageXp

const TABLE = 'xp';

// XP que se gana por cada mensaje elegible (número al azar dentro del rango)
export const XP_MIN_PER_MESSAGE = 15;
export const XP_MAX_PER_MESSAGE = 25;

// Cooldown entre mensajes que otorgan XP. Es una ventana "rolling": se recalcula
// contra Date.now() en cada mensaje nuevo, no hace falta cron ni sobrevive nada
// en memoria — mismo patrón que el rolling window de triviaStore.js.
export const MESSAGE_XP_COOLDOWN_MS = 60 * 1000; // 60 segundos

// Mensajes más cortos que esto no otorgan XP (evita "a", "xd", "jaja" farmeado)
const MIN_CONTENT_LENGTH = 3;

// Multiplicador del ítem de tienda type:'xp_boost' (ver buy.js) mientras xp_boost_until
// no venció todavía.
export const XP_BOOST_MULTIPLIER = 2;

// La tabla usa snake_case (convención de Postgres); el resto del bot sigue trabajando
// con camelCase. Estas dos funciones son el único lugar que conoce ambos formatos.
function rowToRecord(row) {
  if (!row) return { xp: 0, level: 0, lastXpTs: 0, lastContent: '', xpBoostUntil: 0, prestige: 0 };
  return {
    xp: row.xp,
    level: row.level,
    lastXpTs: row.last_xp_ts,
    lastContent: row.last_content,
    // Filas viejas (creadas antes de agregar impulsos/prestigio) no tienen estas
    // columnas todavía si la migración no corrió — 0 es "sin impulso activo"/"nunca prestigió".
    xpBoostUntil: row.xp_boost_until || 0,
    prestige: row.prestige || 0,
  };
}

function recordToRow(guildId, userId, record) {
  return {
    guild_id: guildId,
    user_id: userId,
    xp: record.xp,
    level: record.level,
    last_xp_ts: record.lastXpTs,
    last_content: record.lastContent,
    xp_boost_until: record.xpBoostUntil || 0,
    prestige: record.prestige || 0,
  };
}

export async function getUserXp(guildId, userId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('xp, level, last_xp_ts, last_content, xp_boost_until, prestige')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return rowToRecord(data);
}

export async function saveUserXp(guildId, userId, data) {
  const { error } = await supabase
    .from(TABLE)
    .upsert(recordToRow(guildId, userId, data), { onConflict: 'guild_id,user_id' });

  if (error) throw error;
}

// Devuelve TODOS los registros de XP de un servidor, ordenados de mayor a menor XP
// (el orden lo hace Postgres, no hace falta traer todo a memoria y ordenar acá como
// antes). "limit" es opcional — /ranking solo necesita el top N, no el servidor entero.
export async function getGuildXp(guildId, { limit } = {}) {
  let query = supabase
    .from(TABLE)
    .select('user_id, xp, level, last_xp_ts, last_content, xp_boost_until, prestige')
    .eq('guild_id', guildId)
    .order('xp', { ascending: false });

  if (limit) query = query.limit(limit);

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map((row) => ({ userId: row.user_id, ...rowToRecord(row) }));
}

// XP necesaria para pasar del nivel "level" al "level + 1". Única función que define
// la curva de progresión de todo el bot — para reajustar qué tan difícil es subir de
// nivel, se cambia solo acá, no hay valores de XP hardcodeados en ningún otro archivo.
export function xpRequiredForLevel(level) {
  return 5 * level * level + 50 * level + 100;
}

// Convierte un total de XP acumulada en { level, currentLevelXp, xpForNextLevel, totalXp }.
// currentLevelXp es cuánta XP lleva ganada DENTRO del nivel actual (lo que se muestra
// en la barra de progreso de /perfil y /nivel), no el total acumulado.
export function getLevelProgress(totalXp) {
  let level = 0;
  let remaining = totalXp;
  while (remaining >= xpRequiredForLevel(level)) {
    remaining -= xpRequiredForLevel(level);
    level += 1;
  }
  return { level, currentLevelXp: remaining, xpForNextLevel: xpRequiredForLevel(level), totalXp };
}

// Inversa de getLevelProgress: cuánta XP total hace falta para ALCANZAR un nivel dado
// (partiendo de 0). La usa /xp nivel (staff) para poder fijarle a alguien un nivel
// exacto en vez de un total de XP arbitrario.
export function totalXpForLevel(level) {
  let total = 0;
  for (let l = 0; l < level; l++) total += xpRequiredForLevel(l);
  return total;
}

// Suma (o resta, si amount es negativo) XP a un usuario y recalcula su nivel a partir
// de la misma fórmula centralizada de arriba. "extra" permite guardar otros campos en
// la misma escritura (grantMessageXp lo usa para lastXpTs/lastContent).
//
// El incremento de "xp" en sí es atómico (función SQL increment_xp) — dos mensajes
// casi simultáneos del mismo usuario ya no pueden pisarse la XP ganada. previousTotal
// se calcula matemáticamente (newTotal - amount) en vez de leerlo aparte: como el
// incremento fue atómico, newTotal ya incluye este cambio, así que restarle "amount"
// da exactamente lo que había un instante antes de ESTA llamada, sin importar qué otra
// escritura concurrente haya pasado. El nivel derivado (columna "level") se actualiza
// en un segundo paso, no atómico — pero es un valor derivado de xp, no dinero: en el
// peor caso queda un instante desactualizado hasta el próximo cambio de XP, nunca se
// pierde XP real. No se duplicó la fórmula de niveles en SQL a propósito: xpStore.js
// sigue siendo la única fuente de verdad de la curva de niveles.
// QUÉ CAMBIÓ: emite XP_GAINED cuando amount > 0, con `source: extra.source` si el
// caller lo pasó (grantMessageXp pasa 'message' — ver más abajo; trivia.js pasa 'trivia';
// /xp de staff pasa 'admin' — ver xpStaff.js).
// MOTIVO: auditoría 2026-08-29 (Fase 3, misiones) — mismo criterio que addBalance en
// economyStore.js: un solo primitivo centralizado en vez de tocar cada fuente de XP.
//
// QUÉ CAMBIÓ (Fase A, segunda auditoría 2026-08-30):
//  1. Ya no se hace `await` sobre el emit, por el mismo motivo que addBalance en
//     economyStore.js — no bloquear la operación de dominio esperando a misiones/
//     analítica.
//  2. El payload suma `origin` (resolveXpOrigin, ver economyOrigins.js) — 'admin' para
//     XP otorgada a mano por staff, para que guildDailyStatsStore.xp_distributed no la
//     cuente como actividad del servidor.
export async function addXp(guildId, userId, amount, extra = {}) {
  const { data: newTotal, error } = await supabase.rpc('increment_xp', {
    p_guild_id: guildId,
    p_user_id: userId,
    p_amount: amount,
  });
  if (error) throw error;

  const previousTotal = Math.max(0, newTotal - amount);
  const previousLevel = getLevelProgress(previousTotal).level;
  const progress = getLevelProgress(newTotal);

  const patch = { level: progress.level };
  if ('lastXpTs' in extra) patch.last_xp_ts = extra.lastXpTs;
  if ('lastContent' in extra) patch.last_content = extra.lastContent;

  const { data: row, error: updateError } = await supabase
    .from(TABLE)
    .update(patch)
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .select('xp, level, last_xp_ts, last_content')
    .single();
  if (updateError) throw updateError;

  if (amount > 0) {
    const origin = resolveXpOrigin(extra.source);
    eventBus.emit('XP_GAINED', { guildId, userId, amount, source: extra.source, origin }).catch(() => {});
  }

  return {
    record: rowToRecord(row),
    progress,
    previousLevel,
    newLevel: progress.level,
    leveledUp: progress.level > previousLevel,
    gained: amount,
  };
}

// Fija la XP de un usuario a un valor exacto (lo usa /xp establecer y /xp nivel, staff).
// A propósito NO usa saveUserXp (que reescribe la fila entera): el upsert de acá
// abajo solo incluye xp/level en el payload, así Postgres solo actualiza ESAS
// columnas en el conflicto — si justo en el medio corre un grantMessageXp
// concurrente (que actualiza last_xp_ts/last_content, el cooldown anti-farm),
// esta escritura no lo revierte ni rebobina el cooldown.
export async function setXp(guildId, userId, amount) {
  const record = await getUserXp(guildId, userId);
  const previousLevel = record.level;
  const newTotal = Math.max(0, amount);
  const progress = getLevelProgress(newTotal);

  const { error } = await supabase
    .from(TABLE)
    .upsert({ guild_id: guildId, user_id: userId, xp: newTotal, level: progress.level }, { onConflict: 'guild_id,user_id' });
  if (error) throw error;

  const updated = { ...record, xp: newTotal, level: progress.level };
  return { record: updated, progress, previousLevel, newLevel: progress.level, leveledUp: progress.level > previousLevel };
}

// Único punto de entrada para la XP ganada por actividad en el servidor (messageCreate).
// Aplica todos los filtros anti-farm ANTES de sumar nada; devuelve null si el mensaje
// no era elegible, así el evento no tiene que duplicar ninguna de estas reglas:
//  - mensajes muy cortos (spam de "a"/"xd"/emojis sueltos)
//  - el mismo contenido repetido de forma consecutiva (copy-paste en loop)
//  - cooldown de 60s desde el último mensaje que SÍ dio XP
// "externalMultiplier" lo decide el CALLER (messageCreate.js, que sí conoce guild_config
// — ej. el toggle de finde) — xpStore.js se mantiene sin depender de guild_config, ver el
// comentario del archivo. El impulso comprado en la tienda (xp_boost_until) en cambio se
// resuelve ACÁ porque es un dato propio de esta misma tabla, no de guild_config.
//
// QUÉ CAMBIÓ (Fase 2A, 2026-08-31): todo el cuerpo (leer cooldown, decidir, recién
// después escribir lastXpTs) corre ahora bajo withLock por guild+usuario. Sin esto, dos
// mensajes del mismo usuario procesados casi al mismo tiempo (ej. doble entrega del
// gateway, o dos mensajes mandados con <1 tick de diferencia) podían los dos leer el
// mismo lastXpTs viejo, pasar los dos el chequeo de cooldown, y los dos ganar XP — el
// cooldown de 60s saltado por concurrencia, no por diseño. El lock es por
// guild+usuario, no global: mensajes de otros usuarios (la inmensa mayoría del tráfico)
// nunca se serializan entre sí, solo dos mensajes del MISMO usuario compitiendo por su
// propio cooldown.
export async function grantMessageXp(guildId, userId, content, externalMultiplier = 1) {
  return withLock(`xp-message:${guildId}:${userId}`, async () => {
    const record = await getUserXp(guildId, userId);
    const now = Date.now();
    const trimmed = (content || '').trim();

    if (trimmed.length < MIN_CONTENT_LENGTH) return null;
    if (trimmed === record.lastContent) return null;
    if (now - record.lastXpTs < MESSAGE_XP_COOLDOWN_MS) return null;

    const boostActive = record.xpBoostUntil > now;
    const multiplier = (boostActive ? XP_BOOST_MULTIPLIER : 1) * externalMultiplier;
    const base = Math.floor(Math.random() * (XP_MAX_PER_MESSAGE - XP_MIN_PER_MESSAGE + 1)) + XP_MIN_PER_MESSAGE;
    const gained = Math.floor(base * multiplier);
    return addXp(guildId, userId, gained, { lastXpTs: now, lastContent: trimmed, source: 'message' });
  });
}

// Ítem de tienda type:'xp_boost' (ver buy.js) — extiende (no reemplaza) el impulso: si ya
// tenía uno activo, la nueva compra se SUMA al tiempo restante en vez de desperdiciarlo.
export async function extendXpBoost(guildId, userId, durationMs) {
  const record = await getUserXp(guildId, userId);
  const now = Date.now();
  const newUntil = Math.max(record.xpBoostUntil, now) + durationMs;

  const { error } = await supabase.from(TABLE).update({ xp_boost_until: newUntil }).eq('guild_id', guildId).eq('user_id', userId);
  if (error) throw error;
  return newUntil;
}

// /prestigio: resetea nivel y XP a 0 a cambio de una insignia permanente (⭐×N) — el
// mínimo de nivel para poder hacerlo se valida en el comando, no acá (esta función solo
// aplica el reset, no decide si el usuario tiene permitido pedirlo).
//
// QUÉ CAMBIÓ (Fase 2A, 2026-08-31): antes era read (getUserXp) -> calculate
// (prestige+1) -> write en JS, sin lock ni RPC — dos /prestigio casi simultáneos del
// mismo usuario podían leer el mismo "prestige" viejo y las dos escribir prestige+1, así
// que el resultado final quedaba en +1 en vez de +2 (un incremento perdido). Ahora es una
// sola RPC (apply_prestige, schema.sql) con "for update", mismo patrón que increment_xp/
// increment_balance — Postgres serializa las dos llamadas, ninguna ve el prestige viejo
// de la otra.
export async function applyPrestige(guildId, userId) {
  const { data: newPrestige, error } = await supabase.rpc('apply_prestige', {
    p_guild_id: guildId,
    p_user_id: userId,
  });
  if (error) throw error;
  return newPrestige;
}

// Posición (1-based) de un usuario en el ranking de XP del servidor, o null si nunca ganó XP.
export async function getRank(guildId, userId) {
  const sorted = await getGuildXp(guildId);
  const index = sorted.findIndex((r) => r.userId === userId);
  return index === -1 ? null : index + 1;
}
