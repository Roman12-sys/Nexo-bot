// Bot removido de un servidor (kick o borrado del server) — sin este handler, las
// filas de guild_config y de cada tabla por-guild (economy, xp, warnings, giveaways,
// etc.) quedaban huérfanas para siempre: nada las borraba nunca. Auditoría
// 2026-08-27 encontró que el bot solo tenía guildCreate.js, nunca su contraparte.
//
// QUÉ CAMBIÓ (Fase 2A, 2026-08-31): se agregaron 'active_punishments', 'user_missions' y
// 'guild_daily_stats' — 3 tablas guild-scoped agregadas en fases posteriores a la
// auditoría original que nunca se sumaron acá. Se sacó 'reputation' antes (auditoría
// 2026-08-29, tabla eliminada). Esta lista se comparó a mano contra CADA "create table"
// de schema.sql que tiene guild_id, no solo contra los hallazgos previos de auditoría.
//
// reminders, lol_patch_state y spotify_auth quedan afuera a propósito:
// - reminders: se entregan por DM, guild_id es solo referencia de dónde se creó (ver
//   comentario en schema.sql) — no tiene sentido cancelar un recordatorio pendiente de
//   un usuario solo porque el bot se fue del server donde lo creó.
// - lol_patch_state / spotify_auth: una sola fila fija cada una, sin guild_id — no son
//   guild-scoped, son estado global del bot.
import { supabase } from '../supabaseClient.js';
import { invalidateGuildConfig } from '../utils/guildConfigStore.js';
import { clearGuildAfk } from '../utils/afkStore.js';

export const GUILD_SCOPED_TABLES = [
  'guild_config',
  'voice_channel_config',
  'temporary_voice_channels',
  'voice_channel_stats',
  'economy',
  'economy_transactions',
  'shop_items',
  'xp',
  'warnings',
  'moderation_actions',
  'active_punishments',
  'giveaways',
  'giveaway_entries',
  'trivia_user_stats',
  'user_missions',
  'achievements_unlocked',
  'guild_achievements_unlocked',
  'confession_counters',
  'announcement_templates',
  'command_usage',
  'guild_daily_stats',
];

export const name = 'guildDelete';
export const once = false;

// Idempotente por diseño, sin necesitar ningún chequeo extra: cada paso es un DELETE
// ... WHERE guild_id = X, no un UPDATE relativo ni nada que dependa de estado previo.
// Si esto corre dos veces para el mismo guild (ej. reintento a mano tras un fallo
// parcial), la segunda vuelta borra 0 filas en las tablas que ya habían quedado
// limpias — nunca falla ni afecta otros guilds, porque el filtro es siempre por
// guild_id exacto.
export async function execute(guild) {
  // Promise.allSettled en vez de Promise.all: que una tabla falle (ej. red) no debe
  // impedir que se limpien las demás — se loguea cada fallo individual con la
  // tabla y el guild afectados para poder reintentar a mano si hace falta.
  const results = await Promise.allSettled(
    GUILD_SCOPED_TABLES.map((table) => supabase.from(table).delete().eq('guild_id', guild.id)),
  );

  results.forEach((result, i) => {
    const table = GUILD_SCOPED_TABLES[i];
    if (result.status === 'rejected') {
      console.error(`❌ [guildDelete] Error limpiando tabla "${table}" para guild ${guild.id} (${guild.name}):`, result.reason);
    } else if (result.value?.error) {
      console.error(`❌ [guildDelete] Error limpiando tabla "${table}" para guild ${guild.id} (${guild.name}):`, result.value.error);
    }
  });

  // Sin esto, un guild que el bot vuelve a sumar en la misma vida del proceso (kick +
  // re-invite antes de que expiren los 30s de cache) podía seguir viendo la config
  // vieja en memoria un rato después de que la fila real ya se había borrado de Supabase.
  invalidateGuildConfig(guild.id);

  // Mismo motivo que invalidateGuildConfig: afkStore.js es un Map en memoria, no una
  // tabla de Supabase — no lo limpia ninguna de las DELETE de arriba.
  clearGuildAfk(guild.id);

  console.log(`🧹 Datos limpiados para guild ${guild.id} (${guild.name}) tras salir del servidor.`);
}
