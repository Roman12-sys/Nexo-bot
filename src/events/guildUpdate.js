import { Events, AuditLogEvent } from 'discord.js';
import { createGuildUpdateLogEmbed } from '../utils/logEmbeds.js';
import { findExecutor } from '../utils/auditLog.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';

function diffGuild(oldGuild, newGuild) {
  const changes = [];
  if (oldGuild.name !== newGuild.name) changes.push(`Nombre: \`${oldGuild.name}\` → \`${newGuild.name}\``);
  if (oldGuild.icon !== newGuild.icon) changes.push('Ícono actualizado');
  if (oldGuild.banner !== newGuild.banner) changes.push('Banner actualizado');
  if (oldGuild.verificationLevel !== newGuild.verificationLevel) {
    changes.push(`Nivel de verificación: \`${oldGuild.verificationLevel}\` → \`${newGuild.verificationLevel}\``);
  }
  if (oldGuild.afkChannelId !== newGuild.afkChannelId) changes.push('Canal AFK cambiado');
  return changes;
}

export const name = Events.GuildUpdate;
export const once = false;

export async function execute(oldGuild, newGuild, client) {
  try {
    const changes = diffGuild(oldGuild, newGuild);
    if (changes.length === 0) return;

    const logChannel = await getGuildLogChannel(client, newGuild.id, 'activity');
    if (!logChannel) return;

    const entry = await findExecutor(newGuild, { type: AuditLogEvent.GuildUpdate });

    await logChannel.send({
      embeds: [createGuildUpdateLogEmbed({ executor: entry?.executor || null, changes })],
    });
  } catch (error) {
    console.error('❌ Error registrando actualización del servidor:', error);
  }
}
