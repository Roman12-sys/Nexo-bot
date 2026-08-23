import { Events, AuditLogEvent } from 'discord.js';
import { createChannelLogEmbed } from '../utils/logEmbeds.js';
import { findExecutor } from '../utils/auditLog.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';

function overwritesSignature(channel) {
  return [...channel.permissionOverwrites.cache.values()]
    .map((o) => `${o.id}:${o.allow.bitfield}:${o.deny.bitfield}`)
    .sort()
    .join('|');
}

function diffChannel(oldChannel, newChannel) {
  const changes = [];
  if (oldChannel.name !== newChannel.name) changes.push(`Nombre: \`${oldChannel.name}\` → \`${newChannel.name}\``);
  if (oldChannel.topic !== newChannel.topic) changes.push('Topic actualizado');
  if (oldChannel.nsfw !== newChannel.nsfw) changes.push(`NSFW: \`${Boolean(oldChannel.nsfw)}\` → \`${Boolean(newChannel.nsfw)}\``);
  if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
    changes.push(`Slowmode: \`${oldChannel.rateLimitPerUser ?? 0}s\` → \`${newChannel.rateLimitPerUser ?? 0}s\``);
  }
  if (oldChannel.parentId !== newChannel.parentId) changes.push('Categoría cambiada');
  if (overwritesSignature(oldChannel) !== overwritesSignature(newChannel)) changes.push('Permisos modificados');
  return changes;
}

export const name = Events.ChannelUpdate;
export const once = false;

export async function execute(oldChannel, newChannel, client) {
  if (!newChannel.guild) return;

  try {
    const changes = diffChannel(oldChannel, newChannel);
    if (changes.length === 0) return;

    const logChannel = await getGuildLogChannel(client, newChannel.guild.id, 'activity');
    if (!logChannel) return;

    const entry = await findExecutor(newChannel.guild, {
      type: AuditLogEvent.ChannelUpdate,
      targetId: newChannel.id,
    });

    // /lock y /unlock ya loguean su propio cambio de permisos: no duplicar.
    if (entry?.executor?.id === client.user.id) return;

    await logChannel.send({
      embeds: [
        createChannelLogEmbed({ action: 'update', channel: newChannel, executor: entry?.executor || null, changes }),
      ],
    });
  } catch (error) {
    console.error('❌ Error registrando la actualización de un canal:', error);
  }
}
