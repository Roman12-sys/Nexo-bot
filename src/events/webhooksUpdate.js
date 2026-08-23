import { Events, AuditLogEvent, PermissionFlagsBits } from 'discord.js';
import { createWebhookLogEmbed } from '../utils/logEmbeds.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';

const AUDIT_LOG_WINDOW_MS = 5000;
const WEBHOOK_ACTION_MAP = {
  [AuditLogEvent.WebhookCreate]: 'create',
  [AuditLogEvent.WebhookUpdate]: 'update',
  [AuditLogEvent.WebhookDelete]: 'delete',
};

export const name = Events.WebhooksUpdate;
export const once = false;

// El evento nativo solo da el canal (no qué webhook cambió ni quién lo
// hizo), así que hay que buscar el detalle real en el audit log.
export async function execute(channel, client) {
  const guild = channel.guild;
  if (!guild) return;

  try {
    const me = guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return;

    const auditLogs = await guild.fetchAuditLogs({ limit: 5 });
    const entry = auditLogs.entries.find((e) => {
      const isWebhookAction = e.action in WEBHOOK_ACTION_MAP;
      const isSameChannel = e.target?.channelId === channel.id || e.extra?.channel?.id === channel.id;
      const isRecent = Date.now() - e.createdTimestamp < AUDIT_LOG_WINDOW_MS;
      return isWebhookAction && isSameChannel && isRecent;
    });
    if (!entry) return;

    const logChannel = await getGuildLogChannel(client, guild.id, 'activity');
    if (!logChannel) return;

    await logChannel.send({
      embeds: [
        createWebhookLogEmbed({
          action: WEBHOOK_ACTION_MAP[entry.action],
          channel,
          executor: entry.executor,
          webhookName: entry.target?.name,
        }),
      ],
    });
  } catch (error) {
    console.error('❌ Error registrando cambio de webhook:', error);
  }
}
