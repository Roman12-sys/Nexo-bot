import { Events, AuditLogEvent } from 'discord.js';
import { createWebhookLogEmbed } from '../utils/logEmbeds.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';
import { findExecutor } from '../utils/auditLog.js';

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
    const entry = await findExecutor(guild, {
      filter: (e) => e.action in WEBHOOK_ACTION_MAP && (e.target?.channelId === channel.id || e.extra?.channel?.id === channel.id),
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
