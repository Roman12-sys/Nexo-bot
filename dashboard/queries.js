// Acceso a datos del dashboard: reusa src/supabaseClient.js y los stores que ya existen
// (commandUsageStore, guildAchievements) en vez de reimplementar esas consultas — mismas
// tablas, mismo cliente, corriendo en un proceso Node separado del bot pero contra la
// misma base de Supabase.
import { supabase } from '../src/supabaseClient.js';
import { getTopCommands, getTotalUsage } from '../src/utils/commandUsageStore.js';
import { getUnlockedGuildAchievementIds } from '../src/utils/guildAchievements.js';
import { getGuildGiveawaysForAutocomplete } from '../src/utils/giveawaysStore.js';
import { getGuildTrivia } from '../src/utils/triviaStore.js';
import { getGuildXp } from '../src/utils/xpStore.js';
import { getGuildVoiceStatsSummary } from '../src/utils/tempVoiceStore.js';
import { getGuildMissionCompletionSummary } from '../src/utils/missionsStore.js';
import { getGuildDailyStats } from '../src/utils/guildDailyStatsStore.js';
import { getLastAnnouncedPatchUrl, getLolPatchMonitorState } from '../src/utils/lolPatchStore.js';
import { fetchGuild, fetchGuildMember, fetchGuildMembersWithRole, mapWithConcurrency } from './discordApi.js';
import { isStaffFromRoles } from './permissions.js';

// Caché de metadata de guild (nombre/ícono/dueño) para la LISTA de servidores en la
// home — reduce el N+1 real de listManagedGuilds (una llamada REST por cada guild_config
// del bot, no solo los del usuario que pidió la página) sin tocar la verificación de
// acceso real. Deliberadamente LOCAL a esta función, NO un cambio al fetchGuild()
// compartido de discordApi.js: ese mismo helper lo usa checkGuildAccess() para la
// página real del dashboard de un servidor puntual, que SIEMPRE tiene que verificar en
// vivo — cachear ahí adentro hubiera hecho que el gate de acceso real dependiera de un
// cache stale, justo lo que no queremos. Acá el riesgo es distinto: si esta lista
// muestra algo desactualizado por hasta 5 minutos (nombre/ícono viejo, o un server que
// ya no está más y sigue apareciendo), lo peor que pasa es que el usuario haga click y
// checkGuildAccess() lo rechace fresco — nunca se llega a mostrar un dato sensible sin
// re-verificar. owner_id viaja en la MISMA respuesta que nombre/ícono (un solo request
// de Discord, no se puede pedir "solo el nombre") — se cachea junto, pero el chequeo de
// ROL de staff (fetchGuildMember, lo que determina acceso para quien NO es dueño) nunca
// se cachea: se pide fresco siempre, en cada carga.
// MOTIVO: auditoría Fase 2C, sección 1 — con muchos guild_config, cargar "/" repetía el
// mismo fetchGuild por cada server del bot en CADA carga, sin importar cuántos admins
// pidieran la página en la misma ventana de tiempo.
const GUILD_METADATA_CACHE_TTL_MS = 5 * 60 * 1000;
const guildMetadataCache = new Map(); // guildId -> { guild, expiresAt }

async function fetchGuildCached(guildId) {
  const cached = guildMetadataCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.guild;

  const guild = await fetchGuild(guildId);
  if (guild) guildMetadataCache.set(guildId, { guild, expiresAt: Date.now() + GUILD_METADATA_CACHE_TTL_MS });
  else guildMetadataCache.delete(guildId); // el bot ya no está ahí — no cachear un null
  return guild;
}

// Barrido periódico, mismo criterio que el resto de los Map en memoria del proyecto —
// sin esto, un guild que el bot dejó de tener configurado queda ocupando una entrada
// para siempre (nunca vuelve a pedirse, así que nunca se refresca ni se borra sola).
setInterval(() => {
  const now = Date.now();
  for (const [guildId, entry] of guildMetadataCache) {
    if (entry.expiresAt <= now) guildMetadataCache.delete(guildId);
  }
}, GUILD_METADATA_CACHE_TTL_MS).unref();

// Lista los servidores donde el usuario logueado es dueño o tiene el rol de staff
// configurado — recorre todos los guild_config (uno por server que corrió /setup) y
// descarta los que no aplican. Solo lectura, nada de esto escribe en ningún lado.
// Concurrencia limitada (mapWithConcurrency): esto escala con el TOTAL de servers del
// bot, no solo los del usuario, así que sin límite podía disparar decenas de requests
// en paralelo contra el token del bot en un solo GET a "/".
export async function listManagedGuilds(userId) {
  const { data: configs, error } = await supabase.from('guild_config').select('guild_id, admin_role_id, moderator_role_id');
  if (error) throw error;

  const results = await mapWithConcurrency(configs || [], 5, async (cfg) => {
    const guild = await fetchGuildCached(cfg.guild_id).catch(() => null);
    if (!guild) return null; // el bot ya no está en ese server, o el ID quedó viejo

    const isOwner = guild.owner_id === userId;
    let hasStaffRole = false;
    if (!isOwner && (cfg.admin_role_id || cfg.moderator_role_id)) {
      // Chequeo de rol SIEMPRE en vivo, nunca cacheado — es lo que determina acceso real
      // para quien no es dueño del server.
      const member = await fetchGuildMember(cfg.guild_id, userId).catch(() => null);
      if (member) hasStaffRole = isStaffFromRoles(cfg, member.roles);
    }

    if (!isOwner && !hasStaffRole) return null;
    return { id: guild.id, name: guild.name, icon: guild.icon };
  });

  return results.filter(Boolean);
}

// Reconfirma acceso server-side antes de mostrar cualquier dato de un guild puntual —
// nunca confía en que el link no se haya compartido con alguien sin permiso.
export async function checkGuildAccess(guildId, userId) {
  const { data: cfg, error } = await supabase
    .from('guild_config')
    .select('admin_role_id, moderator_role_id')
    .eq('guild_id', guildId)
    .maybeSingle();
  if (error) throw error;

  const guild = await fetchGuild(guildId, { withCounts: true }).catch(() => null);
  if (!guild) return null;

  const isOwner = guild.owner_id === userId;
  let hasStaffRole = false;
  if (!isOwner && cfg) {
    const member = await fetchGuildMember(guildId, userId).catch(() => null);
    if (member) hasStaffRole = isStaffFromRoles(cfg, member.roles);
  }

  if (!isOwner && !hasStaffRole) return null;
  return { guild };
}

// Corre un array de funciones async (thunks) con como máximo `limit` en vuelo a la vez,
// preservando el orden de resultados — mismo patrón que mapWithConcurrency de
// discordApi.js, pero para funciones YA ARMADAS (acá son 18 fuentes de datos DISTINTAS,
// no la misma función aplicada N veces sobre una lista de items homogénea).
// MOTIVO: auditoría Fase 2C, sección 4 — loadGuildDashboardData disparaba las 18 en un
// solo Promise.all sin ningún límite. Una sola carga de página no es el problema; lo es
// que ESTO puede correr muchas veces a la vez (varios admins, varios servidores) contra
// la MISMA base que también usa el bot para todo lo demás. No es un pool global: es un
// límite chico y explícito, local a esta función.
async function allWithConcurrency(thunks, limit) {
  const results = new Array(thunks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < thunks.length) {
      const i = nextIndex++;
      results[i] = await thunks[i]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, thunks.length) }, worker));
  return results;
}

export async function loadGuildDashboardData(guildId) {
  // activeGiveaways/topTrivia reusan los mismos stores que ya usan los comandos del bot
  // (giveawaysStore/triviaStore) en vez de reimplementar la consulta acá — antes el
  // dashboard no mostraba nada de sorteos ni trivia, a pesar de que la data ya existía.
  //
  // QUÉ CAMBIÓ: se sacó topReputation (getGuildReputation) del Promise.all.
  // MOTIVO: auditoría 2026-08-29 (Diagnóstico Nexo, Parte 11) — reputación eliminada
  // por completo, la tabla ya no existe.
  //
  // QUÉ CAMBIÓ (Fase 5): 6 fuentes nuevas — topXp/xpUserCount, voiceStats,
  // topAchievers, lolConfig+lolState, dailyStats, missionSummary. Todas reusan stores
  // que el bot ya tiene (xpStore, tempVoiceStore, missionsStore, guildDailyStatsStore,
  // lolPatchStore) — mismo criterio que el resto de este archivo, nunca reimplementar
  // una consulta que ya existe del lado del bot.
  //
  // QUÉ CAMBIÓ (Fase 2C): Promise.all (sin límite) → allWithConcurrency con tope 6. Y
  // allBalances.reduce() en JS → fetchTotalBalance (suma hecha en Postgres, ver sección
  // 3 más abajo).
  const [
    topCommands,
    totalCommands,
    unlockedAchievementIds,
    topBalances,
    totalCoins,
    recentWarns,
    totalWarns,
    activeGiveaways,
    topTrivia,
    punishedInfo,
    topXpRaw,
    xpUserCount,
    voiceStats,
    topAchievers,
    lolConfig,
    lolLastUrl,
    lolMonitorState,
    dailyStats,
    missionSummary,
    guildConfig,
  ] = await allWithConcurrency(
    [
      () => getTopCommands(guildId, 5),
      () => getTotalUsage(guildId),
      () => getUnlockedGuildAchievementIds(guildId),
      () => fetchTopBalances(guildId),
      () => fetchTotalBalance(guildId),
      () => fetchRecentWarns(guildId),
      () => fetchWarnCount(guildId),
      () => getGuildGiveawaysForAutocomplete(guildId, false),
      () => getGuildTrivia(guildId, { limit: 5 }),
      () => fetchPunishedMembers(guildId),
      () => getGuildXp(guildId, { limit: 10 }),
      () => fetchXpUserCount(guildId),
      () => getGuildVoiceStatsSummary(guildId),
      () => fetchTopAchievers(guildId),
      () => fetchLolChannelId(guildId),
      () => getLastAnnouncedPatchUrl(),
      () => getLolPatchMonitorState(),
      // 14 días (antes 7) — Fase A, segunda auditoría 2026-08-30: hacen falta las dos
      // semanas para el delta de abajo. No es una query nueva ni más pesada, es el mismo
      // select con un `days` más grande.
      () => getGuildDailyStats(guildId, 14),
      () => getGuildMissionCompletionSummary(guildId),
      // DASH-1, Fase 4B: antes checkGuildAccess() ya leía admin_role_id/moderator_role_id
      // para el gate de acceso pero los descartaba sin mostrarlos nunca — el dashboard
      // tenía la data a mano y jamás la usaba. Ver fetchGuildConfigSummary más abajo.
      () => fetchGuildConfigSummary(guildId),
    ],
    6,
  );

  const messagesDelta = computeMessagesWeeklyDelta(dailyStats);

  return {
    topCommands,
    totalCommands,
    unlockedAchievementIds,
    topBalances,
    totalCoins,
    recentWarns,
    totalWarns,
    activeGiveaways,
    topTrivia: topTrivia.filter((row) => row.points > 0),
    punishedMembers: punishedInfo.members,
    punishedTotal: punishedInfo.total,
    punishedPossiblyIncomplete: punishedInfo.possiblyIncomplete,
    topXp: topXpRaw.filter((row) => row.xp > 0),
    xpUserCount,
    voiceStats,
    topAchievers,
    lolChannelId: lolConfig,
    lolLastUrl,
    lolLastAnnouncedAt: lolMonitorState.patchEngineUpdatedAt,
    // La tarjeta sigue mostrando 7 días (mismo tamaño visual de siempre) — los 14 que se
    // pidieron arriba son solo para poder calcular messagesDelta.
    dailyStats: dailyStats.slice(-7),
    messagesDelta,
    missionSummary,
    guildConfig,
  };
}

// DASH-1, Fase 4B: única fuente de la tarjeta "Configuración actual" — antes el
// dashboard no mostraba NADA de guild_config más allá de lo que usaba internamente
// para el gate de acceso. Selecciona exactamente las columnas que la tarjeta necesita
// (permisos, logs, módulos, extras de /setup) — no un `select('*')`, mismo criterio que
// el resto de este archivo (nunca traer más de lo que se va a usar).
async function fetchGuildConfigSummary(guildId) {
  const { data, error } = await supabase
    .from('guild_config')
    .select(
      'admin_role_id, moderator_role_id, log_channel_moderation_id, log_channel_activity_id, log_channel_economy_id, features, punish_role_id, auto_role_id, welcome_channel_id, confession_channel_id, report_channel_id',
    )
    .eq('guild_id', guildId)
    .maybeSingle();
  if (error) throw error;
  return data ?? {};
}

// Fase A, segunda auditoría 2026-08-30 (Parte 12: "convertir analítica en información
// accionable", no agregar pantallas nuevas). Opera sobre los mismos 14 días que ya trae
// getGuildDailyStats — no dispara ninguna query nueva. Solo devuelve un delta si hay
// datos reales en las dos mitades de la ventana; si el servidor recién empezó a
// acumular guild_daily_stats (o tiene menos de 2 semanas de historial), devuelve null y
// el dashboard simplemente no muestra la comparación — nunca inventa un "-100%" contra
// días que la tabla no llegó a cubrir.
function computeMessagesWeeklyDelta(dailyStats) {
  const today = new Date();
  const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const byDate = new Map(dailyStats.map((d) => [d.date, d.messagesSent]));

  let current = 0;
  let previous = 0;
  let hasCurrent = false;
  let hasPrevious = false;

  for (let i = 0; i < 14; i++) {
    const key = new Date(todayUTC - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const value = byDate.get(key);
    if (value === undefined) continue;
    if (i < 7) {
      current += value;
      hasCurrent = true;
    } else {
      previous += value;
      hasPrevious = true;
    }
  }

  if (!hasCurrent || !hasPrevious || previous === 0) return null;
  return { current, previous, deltaPct: Math.round(((current - previous) / previous) * 100) };
}

// La función para listar sancionados ya existe del lado del bot (src/utils/sanctions.js,
// getPunishedMembers) pero usa un Client de discord.js conectado al gateway — acá no hay
// eso, así que se resuelve por REST (fetchGuildMembersWithRole). Antes el dashboard no
// mostraba esto en absoluto.
//
// QUÉ CAMBIÓ (Fase 2C, sección 2): antes devolvía TODOS los IDs con el rol de sanción
// (hasta 1000, el máximo de una página de Discord) y el caller los resolvía uno por uno
// contra la API de Discord (resolveUsers en server.js) para mostrar sus nombres — con un
// servidor que acumuló muchos sancionados con el tiempo, eso eran cientos de requests
// solo para una tabla que en la UI ya se veía truncada visualmente. Ahora se corta acá
// (PUNISHED_MEMBERS_DISPLAY_LIMIT) y se devuelve el total real aparte, para que la UI
// pueda seguir mostrando "Sancionados activos (147)" con un "+N más" en vez de 147 filas.
const PUNISHED_MEMBERS_DISPLAY_LIMIT = 20;

async function fetchPunishedMembers(guildId) {
  const { data: cfg, error } = await supabase.from('guild_config').select('punish_role_id').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  if (!cfg?.punish_role_id) return { members: [], total: 0, possiblyIncomplete: false };

  const { members, possiblyIncomplete } = await fetchGuildMembersWithRole(guildId, cfg.punish_role_id);
  return {
    members: members.slice(0, PUNISHED_MEMBERS_DISPLAY_LIMIT).map((m) => m.user.id),
    total: members.length,
    possiblyIncomplete,
  };
}

async function fetchTopBalances(guildId) {
  const { data, error } = await supabase
    .from('economy')
    .select('user_id, balance')
    .eq('guild_id', guildId)
    .order('balance', { ascending: false })
    .limit(10);
  if (error) throw error;
  return data ?? [];
}

// QUÉ CAMBIÓ (Fase 2C, sección 3): antes (fetchAllBalances) traía la columna `balance`
// de CADA fila de economy del server entero solo para sumarlas en JS — filas
// transferidas creciendo sin límite con la cantidad histórica de usuarios con economía,
// para terminar en UN solo número. sum_guild_balances (RPC, ver migración preparada en
// schema.sql) hace la suma en Postgres: cero filas transferidas de más, mismo resultado.
async function fetchTotalBalance(guildId) {
  const { data, error } = await supabase.rpc('sum_guild_balances', { p_guild_id: guildId });
  if (error) throw error;
  return Number(data) || 0;
}

async function fetchRecentWarns(guildId) {
  const { data, error } = await supabase
    .from('warnings')
    .select('user_id, reason, moderator_id, created_at')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false })
    .limit(15);
  if (error) throw error;
  return data ?? [];
}

async function fetchWarnCount(guildId) {
  const { count, error } = await supabase.from('warnings').select('id', { count: 'exact', head: true }).eq('guild_id', guildId);
  if (error) throw error;
  return count ?? 0;
}

async function fetchXpUserCount(guildId) {
  const { count, error } = await supabase.from('xp').select('user_id', { count: 'exact', head: true }).eq('guild_id', guildId).gt('xp', 0);
  if (error) throw error;
  return count ?? 0;
}

// Top-5 usuarios por cantidad de logros desbloqueados.
//
// QUÉ CAMBIÓ (Fase 2C, sección 3): antes traía TODAS las filas de achievements_unlocked
// del guild (una fila por logro desbloqueado, nunca se borran — crece para siempre con
// la actividad histórica) solo para agruparlas y contarlas en JS. A diferencia de
// getGuildFrequentReasons (moderationActionsStore.js), que agrega en JS sobre un
// `.limit(200)` explícito y acotado a propósito, acá no había ningún límite — el mismo
// patrón "traer todo para reducir en Node" pero sin cota. top_guild_achievers (RPC, ver
// migración preparada en schema.sql) hace el group+count+order+limit en Postgres:
// como mucho 5 filas transferidas, nunca el histórico completo.
async function fetchTopAchievers(guildId) {
  const { data, error } = await supabase.rpc('top_guild_achievers', { p_guild_id: guildId, p_limit: 5 });
  if (error) throw error;
  return (data || []).map((row) => ({ userId: row.user_id, count: Number(row.unlock_count) }));
}

async function fetchLolChannelId(guildId) {
  const { data, error } = await supabase.from('guild_config').select('lol_announce_channel_id').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  return data?.lol_announce_channel_id ?? null;
}
