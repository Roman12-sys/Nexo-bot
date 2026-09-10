import { getGuildConfig } from './guildConfigStore.js';
import { getLogChannel } from './auditLog.js';

const CATEGORY_COLUMN = {
  moderation: 'log_channel_moderation_id',
  activity: 'log_channel_activity_id',
  economy: 'log_channel_economy_id',
};

// Resuelve y valida el canal de logs de una categoría para un servidor.
// category: 'moderation' | 'activity' | 'economy'. Devuelve null si el servidor
// no lo configuró (todavía no corrió /setup para esa sección) o el canal ya no existe.
export async function getGuildLogChannel(client, guildId, category) {
  const column = CATEGORY_COLUMN[category];
  if (!column) throw new Error(`Categoría de log desconocida: ${category}`);

  const cfg = await getGuildConfig(guildId);
  return getLogChannel(client, cfg[column]);
}
