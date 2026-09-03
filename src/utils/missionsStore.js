// QUÉ CAMBIÓ: archivo nuevo. Misiones diarias/semanales, enganchadas al Event Engine
// (eventBus.js) — se completan y pagan solas, sin ningún /mision reclamar.
// MOTIVO: auditoría 2026-08-29 (Diagnóstico Nexo, Parte 10 y Parte 22, Fase 3).
//
// DECISIONES QUE SE DESVÍAN DEL PEDIDO ORIGINAL, a propósito:
// 1. Sin tabla `mission_definitions`: el catálogo (qué misiones existen, objetivo,
//    recompensa) vive fijo en código, más abajo — mismo criterio que ACHIEVEMENTS en
//    achievements.js ("cosmético, no vale la pena la superficie de admin"). Menos
//    tablas, menos superficie, y es exactamente el patrón que este proyecto ya usa para
//    algo con la misma forma (una lista fija de "logros/misiones con objetivo y premio").
// 2. Sin /mision reclamar: la recompensa se paga en el mismo instante en que la misión
//    se completa (ver increment_mission_progress en schema.sql), igual que un logro se
//    desbloquea solo al cumplir la condición. Un paso de "reclamar" manual sería el
//    único lugar de todo el bot que pide una acción extra después de cumplir un
//    objetivo — inconsistente con logros y subida de nivel, que nunca lo piden.
// 3. Sin misiones "seasonal": la auditoría (Parte 16) recomendó explícitamente NO
//    construir temporadas todavía — meter el campo acá sin nada real detrás sería
//    scope creep contra esa misma recomendación.
// 4. Sin /mision ranking en esta primera versión: requeriría un contador de por vida
//    separado del progreso por período — se puede sumar después sin romper nada de lo
//    que hay acá, no vale la pena adelantarlo sin uso real todavía.
//
// VERIFICACIÓN: /mision ver muestra 4 misiones diarias + 2 semanales con progreso 0 la
// primera vez que se corre. Mandar mensajes/pasar tiempo en voz/ganar monedas/subir de
// nivel/acertar trivia hace avanzar la barra correspondiente sin que el usuario haga
// nada más; al llegar al objetivo, el balance y la XP suben solos (mismo followUp que
// ya usan daily/work, no un mensaje nuevo).
//
// QUÉ CAMBIÓ (después de la versión original de este archivo): se sumó daily_voice,
// enganchada al mismo XP_GAINED que daily_messages pero filtrando source:'voice' en vez
// de 'message' — voiceXpEngine.js ya daba XP por tiempo en voz cada 5 minutos desde
// antes de esta auditoría, esto solo lo conecta a misiones etiquetando ese origen.
//
// QUÉ CAMBIÓ (Fase A, segunda auditoría 2026-08-30):
//  1. El handler de COINS_EARNED ahora filtra por `origin` (ver economyOrigins.js) en vez
//     de sumar cualquier monto positivo — un ajuste de staff o el payout bruto de casino
//     ya no hacen avanzar daily_earn/weekly_earn (ver el handler más abajo).
//  2. ensureCurrentMissions() ya no re-upsertea las 6 filas del catálogo en cada evento
//     de XP/coins — un caché en memoria por (guild,user) recuerda que ya se aseguró el
//     período actual y se salta el upsert hasta que cambie el día (ver ensuredCache más
//     abajo). Sigue siendo seguro sin esa memoria: si el proceso reinicia, la próxima
//     llamada vuelve a upsertear (no-op idempotente si las filas ya existen) — la
//     memoria es solo para no repetir trabajo, nunca la fuente de verdad de si el
//     período ya está inicializado (eso lo sigue siendo la fila de Postgres).
import { supabase } from '../supabaseClient.js';
import { eventBus } from './eventBus.js';
import { addBalance } from './economyStore.js';
import { addXp } from './xpStore.js';
import { utcMidnightMs, DAY_MS } from './timePeriods.js';

const TABLE = 'user_missions';

export const MISSION_CATALOG = [
  { id: 'daily_messages', period: 'daily', description: 'Mandá 15 mensajes que den XP', target: 15, rewardCoins: 50, rewardXp: 15 },
  { id: 'daily_trivia', period: 'daily', description: 'Respondé 1 pregunta de /trivia correctamente', target: 1, rewardCoins: 40, rewardXp: 0 },
  { id: 'daily_earn', period: 'daily', description: 'Ganá 150 monedas (cualquier fuente)', target: 150, rewardCoins: 60, rewardXp: 10 },
  // target: 6 = 6 barridos de 5 min de voiceXpEngine.js ≈ 30 minutos reales. Solo
  // avanza en los mismos ticks que ya dan XP de voz (2+ humanos, no ensordecido) — no
  // hay tracking de tiempo nuevo, hereda gratis esas protecciones anti-AFK.
  { id: 'daily_voice', period: 'daily', description: 'Pasá al menos 30 minutos en un canal de voz activo (con más gente)', target: 6, rewardCoins: 50, rewardXp: 15 },
  { id: 'weekly_level', period: 'weekly', description: 'Subí al menos 1 nivel', target: 1, rewardCoins: 300, rewardXp: 0 },
  { id: 'weekly_earn', period: 'weekly', description: 'Ganá 1.000 monedas', target: 1000, rewardCoins: 500, rewardXp: 0 },
];
const MISSION_BY_ID = new Map(MISSION_CATALOG.map((m) => [m.id, m]));

// Día/semana UTC — mismo criterio que isWeekendUTC() en xpEngine.js: no hay forma de
// saber la zona horaria de una comunidad, UTC es lo único no ambiguo. utcMidnightMs
// (timePeriods.js) es la misma cuenta que usa guildDailyStatsStore.todayUTC() para su
// propia frontera de "hoy" — un solo lugar decide dónde cae la medianoche UTC, cada
// store solo la formatea a lo que su columna necesita (bigint acá, date real allá).
function getDailyPeriodStart(now = Date.now()) {
  return utcMidnightMs(now);
}
function getWeeklyPeriodStart(now = Date.now()) {
  const dayStart = getDailyPeriodStart(now);
  const dayOfWeek = new Date(dayStart).getUTCDay(); // 0=domingo … 6=sábado
  const daysSinceMonday = (dayOfWeek + 6) % 7; // lunes=0
  return dayStart - daysSinceMonday * DAY_MS;
}
function periodStartFor(period) {
  return period === 'daily' ? getDailyPeriodStart() : getWeeklyPeriodStart();
}

function rowToMission(row) {
  const def = MISSION_BY_ID.get(row.mission_id);
  return {
    id: row.mission_id,
    period: row.period,
    description: def?.description ?? row.mission_id,
    progress: row.progress,
    target: row.target,
    rewardCoins: row.reward_coins,
    rewardXp: row.reward_xp,
    completedAt: row.completed_at,
  };
}

// Caché en memoria, solo para no repetir el upsert de las 6 filas del catálogo en cada
// evento de XP/coins dentro del mismo período — NO es la fuente de verdad de si el
// período ya está inicializado (eso es Postgres, vía el upsert idempotente de abajo).
// Clave `guild:user` -> "dailyStart:weeklyStart" ya asegurado. Se vacía sola una vez por
// día (cuando cambia dailyStart) en vez de crecer para siempre — mismo criterio que el
// resto de los Map en memoria del proyecto (rateLimiter, spamDetector, etc.).
const ensuredCache = new Map();
let ensuredCacheDailyStart = 0;

function ensuredStampFor(dailyStart, weeklyStart) {
  if (dailyStart !== ensuredCacheDailyStart) {
    ensuredCache.clear();
    ensuredCacheDailyStart = dailyStart;
  }
  return `${dailyStart}:${weeklyStart}`;
}

// Idempotente: upsert con ignoreDuplicates, así se puede llamar tanto desde /mision ver
// como desde cada handler de evento sin duplicar filas ni pisar progreso ya existente.
async function ensureCurrentMissions(guildId, userId) {
  const dailyStart = getDailyPeriodStart();
  const weeklyStart = getWeeklyPeriodStart();
  const cacheKey = `${guildId}:${userId}`;
  const stamp = ensuredStampFor(dailyStart, weeklyStart);
  if (ensuredCache.get(cacheKey) === stamp) return; // ya se aseguró este período — no repetir el upsert

  const rows = MISSION_CATALOG.map((m) => ({
    guild_id: guildId,
    user_id: userId,
    mission_id: m.id,
    period: m.period,
    period_start: m.period === 'daily' ? dailyStart : weeklyStart,
    progress: 0,
    target: m.target,
    reward_coins: m.rewardCoins,
    reward_xp: m.rewardXp,
  }));

  const { error } = await supabase.from(TABLE).upsert(rows, { onConflict: 'guild_id,user_id,mission_id,period_start', ignoreDuplicates: true });
  if (error) throw error;
  ensuredCache.set(cacheKey, stamp);
}

// Usado por /mision ver — trae las 5 instancias del ciclo ACTUAL (no el historial).
export async function getUserMissions(guildId, userId) {
  await ensureCurrentMissions(guildId, userId);

  const currentStarts = [getDailyPeriodStart(), getWeeklyPeriodStart()];
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .in('period_start', currentStarts);

  if (error) throw error;
  return (data || []).map(rowToMission);
}

// Motor de progreso: lo llaman los handlers de eventos de más abajo, nunca un comando
// directamente. Paga la recompensa apenas la RPC confirma que ESTA llamada completó la
// misión (just_completed) — así dos eventos casi simultáneos no pagan doble.
async function incrementMissionProgress(guildId, userId, missionId, amount) {
  const def = MISSION_BY_ID.get(missionId);
  if (!def) return;

  await ensureCurrentMissions(guildId, userId);

  const { data, error } = await supabase.rpc('increment_mission_progress', {
    p_guild_id: guildId,
    p_user_id: userId,
    p_mission_id: missionId,
    p_period_start: periodStartFor(def.period),
    p_amount: amount,
    p_now: Date.now(),
  });
  if (error) throw error;

  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.just_completed) return;

  // addBalance/addXp ya son atómicos por su cuenta — no hace falta reimplementar el
  // pago dentro de la RPC de arriba, solo dispararlo una vez que ella confirma que
  // corresponde.
  //
  // GARANTÍA DE "UNA SOLA VEZ", explícita: addBalance de acá abajo vuelve a emitir
  // COINS_EARNED (type: 'mission') — eso es una cascada real, no hipotética
  // (COINS_EARNED → incrementMissionProgress → addBalance → COINS_EARNED). No se corta
  // sola por "las misiones solo completan una vez" (eso protege contra pagar la MISMA
  // recompensa dos veces, no contra que la recompensa haga avanzar OTRA misión). Lo que
  // realmente corta la cadena es que economyOrigins.js clasifica `type: 'mission'` como
  // origin 'reward', y el handler de COINS_EARNED de más abajo ignora explícitamente
  // 'reward' — si algún día se agrega una misión nueva que dependa de COINS_EARNED, esa
  // exclusión es la que hay que mirar antes de tocar nada más.
  if (result.reward_coins > 0) await addBalance(guildId, userId, result.reward_coins, { type: 'mission', reason: def.description });
  if (result.reward_xp > 0) await addXp(guildId, userId, result.reward_xp);
}

// Para el dashboard (Fase 5) — cuántos usuarios DISTINTOS completaron al menos una
// misión en el ciclo actual (no cuántas misiones en total: alguien que completó las 3
// diarias cuenta una sola vez). Vive acá y no en dashboard/queries.js para no duplicar
// el cálculo de period_start en dos archivos.
export async function getGuildMissionCompletionSummary(guildId) {
  const [dailyRows, weeklyRows] = await Promise.all([
    supabase.from(TABLE).select('user_id').eq('guild_id', guildId).eq('period_start', getDailyPeriodStart()).not('completed_at', 'is', null),
    supabase.from(TABLE).select('user_id').eq('guild_id', guildId).eq('period_start', getWeeklyPeriodStart()).not('completed_at', 'is', null),
  ]);
  if (dailyRows.error) throw dailyRows.error;
  if (weeklyRows.error) throw weeklyRows.error;

  return {
    dailyCompletedUsers: new Set((dailyRows.data || []).map((r) => r.user_id)).size,
    weeklyCompletedUsers: new Set((weeklyRows.data || []).map((r) => r.user_id)).size,
  };
}

// Observabilidad mínima (Fase A, Parte 13): nombre de la misión + guild/user (nunca
// contenido de mensajes ni otro dato sensible) — suficiente para diagnosticar en los
// logs de Railway sin necesitar una plataforma de observabilidad nueva.
function logMissionError(missionId, guildId, userId, error) {
  console.error(`❌ Error actualizando progreso de misión '${missionId}' (guild ${guildId}, user ${userId}):`, error);
}

// --- Handlers del Event Engine — cada uno mapea un evento de dominio a la(s) misión(es)
// que le corresponden. Registrados acá (no en cada feature de origen) porque esta es la
// infraestructura de misiones, no la de mensajes/economía/XP/trivia.

eventBus.on('XP_GAINED', async ({ guildId, userId, source }) => {
  if (source === 'message') {
    await incrementMissionProgress(guildId, userId, 'daily_messages', 1).catch((error) => logMissionError('daily_messages', guildId, userId, error));
  } else if (source === 'voice') {
    await incrementMissionProgress(guildId, userId, 'daily_voice', 1).catch((error) => logMissionError('daily_voice', guildId, userId, error));
  }
  // trivia o /xp de staff no tienen source 'message'/'voice' — no cuentan para ninguna
  // de las dos misiones de arriba, a propósito.
});

// QUÉ CAMBIÓ (Fase A, segunda auditoría 2026-08-30): filtra por `origin` en vez de sumar
// cualquier monto positivo.
//  - 'admin'  → ajuste de staff, se ignora entero (no es actividad del usuario).
//  - 'reward' → recompensa de OTRA misión ya pagada, se ignora entero (evita la cadena
//    COINS_EARNED → misión → recompensa → COINS_EARNED, ver el comentario en
//    incrementMissionProgress).
//  - 'stake'  → casino/caja misteriosa: se cuenta `netAmount` (la ganancia real), nunca
//    el payout bruto que ya se acreditó al balance.
//  - 'activity' (default) → se cuenta `amount` completo, igual que siempre.
eventBus.on('COINS_EARNED', async ({ guildId, userId, amount, netAmount, origin }) => {
  if (origin === 'admin' || origin === 'reward') return;
  const countedAmount = origin === 'stake' ? netAmount : amount;
  if (!(countedAmount > 0)) return; // una apuesta con ganancia neta <= 0 no suma progreso

  await Promise.all([
    incrementMissionProgress(guildId, userId, 'daily_earn', countedAmount).catch((error) => logMissionError('daily_earn', guildId, userId, error)),
    incrementMissionProgress(guildId, userId, 'weekly_earn', countedAmount).catch((error) => logMissionError('weekly_earn', guildId, userId, error)),
  ]);
});

eventBus.on('LEVEL_UP', async ({ guildId, userId }) => {
  await incrementMissionProgress(guildId, userId, 'weekly_level', 1).catch((error) => logMissionError('weekly_level', guildId, userId, error));
});

eventBus.on('TRIVIA_CORRECT', async ({ guildId, userId }) => {
  await incrementMissionProgress(guildId, userId, 'daily_trivia', 1).catch((error) => logMissionError('daily_trivia', guildId, userId, error));
});
