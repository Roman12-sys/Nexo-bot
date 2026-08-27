// Bot removido de un servidor (kick o borrado del server) — sin este handler, las
// filas de guild_config y de cada tabla por-guild (economy, xp, warnings, giveaways,
// pets, etc.) quedaban huérfanas para siempre: nada las borraba nunca. Auditoría
// 2026-08-27 encontró que el bot solo tenía guildCreate.js, nunca su contraparte.
//
// reminders y lol_patch_state quedan afuera a propósito:
// - reminders: se entregan por DM, guild_id es solo referencia de dónde se creó (ver
//   comentario en schema.sql) — no tiene sentido cancelar un recordatorio pendiente de
//   un usuario solo porque el bot se fue del server donde lo creó.
// - lol_patch_state: una sola fila fija ('league_of_legends'), no tiene guild_id.
import { supabase } from '../supabaseClient.js';

const GUILD_SCOPED_TABLES = [
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
  'giveaways',
  'giveaway_entries',
  'trivia_user_stats',
  'reputation',
  'achievements_unlocked',
  'guild_achievements_unlocked',
  'confession_counters',
  'announcement_templates',
  'pets',
  'command_usage',
];

export const name = 'guildDelete';
export const once = false;

export async function execute(guild) {
  // Promise.allSettled en vez de Promise.all: que una tabla falle (ej. red) no debe
  // impedir que se limpien las otras 19 — se loguea cada fallo individual con la
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

  console.log(`🧹 Datos limpiados para guild ${guild.id} (${guild.name}) tras salir del servidor.`);
}
