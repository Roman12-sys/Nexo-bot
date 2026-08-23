// Acceso a datos del dashboard: reusa src/supabaseClient.js y los stores que ya existen
// (commandUsageStore, guildAchievements) en vez de reimplementar esas consultas — mismas
// tablas, mismo cliente, corriendo en un proceso Node separado del bot pero contra la
// misma base de Supabase.
import { supabase } from '../src/supabaseClient.js';
import { getTopCommands, getTotalUsage } from '../src/utils/commandUsageStore.js';
import { getUnlockedGuildAchievementIds } from '../src/utils/guildAchievements.js';
import { fetchGuild, fetchGuildMember, mapWithConcurrency } from './discordApi.js';
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
  const [topCommands, totalCommands, unlockedAchievementIds, topBalances, allBalances, recentWarns, totalWarns] = await Promise.all([
    getTopCommands(guildId, 5),
    getTotalUsage(guildId),
    getUnlockedGuildAchievementIds(guildId),
    fetchTopBalances(guildId),
    fetchAllBalances(guildId),
    fetchRecentWarns(guildId),
    fetchWarnCount(guildId),
  ]);

  return {
    topCommands,
    totalCommands,
    unlockedAchievementIds,
    topBalances,
    totalCoins: allBalances.reduce((sum, row) => sum + Number(row.balance), 0),
    recentWarns,
    totalWarns,
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
