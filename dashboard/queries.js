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
    const guild = await fetchGuild(cfg.guild_id).catch(() => null);
    if (!guild) return null; // el bot ya no está en ese server, o el ID quedó viejo

    const isOwner = guild.owner_id === userId;
    let hasStaffRole = false;
    if (!isOwner && (cfg.admin_role_id || cfg.moderator_role_id)) {
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
  const [
    topCommands,
    totalCommands,
    unlockedAchievementIds,
    topBalances,
    allBalances,
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
  ] = await Promise.all([
    getTopCommands(guildId, 5),
    getTotalUsage(guildId),
    getUnlockedGuildAchievementIds(guildId),
    fetchTopBalances(guildId),
    fetchAllBalances(guildId),
    fetchRecentWarns(guildId),
    fetchWarnCount(guildId),
    getGuildGiveawaysForAutocomplete(guildId, false),
    getGuildTrivia(guildId, { limit: 5 }),
    fetchPunishedMembers(guildId),
    getGuildXp(guildId, { limit: 10 }),
    fetchXpUserCount(guildId),
    getGuildVoiceStatsSummary(guildId),
    fetchTopAchievers(guildId),
    fetchLolChannelId(guildId),
    getLastAnnouncedPatchUrl(),
    getLolPatchMonitorState(),
    getGuildDailyStats(guildId, 7),
    getGuildMissionCompletionSummary(guildId),
  ]);

  return {
    topCommands,
    totalCommands,
    unlockedAchievementIds,
    topBalances,
    totalCoins: allBalances.reduce((sum, row) => sum + Number(row.balance), 0),
    recentWarns,
    totalWarns,
    activeGiveaways,
    topTrivia: topTrivia.filter((row) => row.points > 0),
    punishedMembers: punishedInfo.members,
    punishedPossiblyIncomplete: punishedInfo.possiblyIncomplete,
    topXp: topXpRaw.filter((row) => row.xp > 0),
    xpUserCount,
    voiceStats,
    topAchievers,
    lolChannelId: lolConfig,
    lolLastUrl,
    lolLastAnnouncedAt: lolMonitorState.patchEngineUpdatedAt,
    dailyStats,
    missionSummary,
  };
}

// La función para listar sancionados ya existe del lado del bot (src/utils/sanctions.js,
// getPunishedMembers) pero usa un Client de discord.js conectado al gateway — acá no hay
// eso, así que se resuelve por REST (fetchGuildMembersWithRole). Antes el dashboard no
// mostraba esto en absoluto.
async function fetchPunishedMembers(guildId) {
  const { data: cfg, error } = await supabase.from('guild_config').select('punish_role_id').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  if (!cfg?.punish_role_id) return { members: [], possiblyIncomplete: false };

  const { members, possiblyIncomplete } = await fetchGuildMembersWithRole(guildId, cfg.punish_role_id);
  return { members: members.map((m) => m.user.id), possiblyIncomplete };
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

async function fetchAllBalances(guildId) {
  const { data, error } = await supabase.from('economy').select('balance').eq('guild_id', guildId);
  if (error) throw error;
  return data ?? [];
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

// Top-5 usuarios por cantidad de logros desbloqueados — achievements_unlocked es una
// fila por logro (no pre-agregada), así que se cuenta en JS sobre las filas del guild,
// mismo patrón que getGuildFrequentReasons en moderationActionsStore.js.
async function fetchTopAchievers(guildId) {
  const { data, error } = await supabase.from('achievements_unlocked').select('user_id').eq('guild_id', guildId);
  if (error) throw error;

  const counts = new Map();
  for (const row of data || []) counts.set(row.user_id, (counts.get(row.user_id) || 0) + 1);

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([userId, count]) => ({ userId, count }));
}

async function fetchLolChannelId(guildId) {
  const { data, error } = await supabase.from('guild_config').select('lol_announce_channel_id').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  return data?.lol_announce_channel_id ?? null;
}
