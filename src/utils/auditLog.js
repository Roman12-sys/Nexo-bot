import { PermissionFlagsBits } from 'discord.js';

const DEFAULT_WINDOW_MS = 5000;

// Busca en el audit log una entrada reciente que matchee el tipo (y opcionalmente
// el target y un filtro extra). Devuelve null si no hay acceso, no hay match, o falla.
export async function findExecutor(guild, { type, targetId, filter, windowMs = DEFAULT_WINDOW_MS }) {
  try {
    const me = guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return null;

    const auditLogs = await guild.fetchAuditLogs({ type, limit: 5 });
    const entry = auditLogs.entries.find((e) => {
      const isSameTarget = targetId ? e.target?.id === targetId : true;
      const isRecent = Date.now() - e.createdTimestamp < windowMs;
      const passesFilter = filter ? filter(e) : true;
      return isSameTarget && isRecent && passesFilter;
    });

    return entry || null;
  } catch (error) {
    console.error('⚠️ No se pudo consultar el registro de auditoría:', error);
    return null;
  }
}

// Fetch + validación del canal de logs, reutilizado en cada handler.
// channelId es el id resuelto para la categoría correspondiente (moderación/
// actividad/economía) vía getLogChannelId() de guildLogChannels.js.
export async function getLogChannel(client, channelId) {
  if (!channelId) return null;
  const logChannel = await client.channels.fetch(channelId).catch(() => null);
  if (!logChannel || !logChannel.isTextBased()) return null;
  return logChannel;
}
