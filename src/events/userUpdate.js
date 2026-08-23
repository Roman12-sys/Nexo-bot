import { Events } from 'discord.js';
import { createAvatarChangeLogEmbed, createUsernameChangeLogEmbed } from '../utils/logEmbeds.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';

export const name = Events.UserUpdate;
export const once = false;

export async function execute(oldUser, newUser, client) {
  try {
    // userUpdate dispara para cualquier usuario cacheado por el bot, sin
    // atarse a un servidor puntual (a diferencia de gNoX, que era single-tenant
    // y filtraba por config.guildId). En NEXOBOT recorremos todos los servidores
    // donde el bot está y en los que el usuario está cacheado como miembro,
    // logueando el cambio en el canal de actividad configurado de cada uno.
    const guildsWithMember = client.guilds.cache.filter((guild) => guild.members.cache.has(newUser.id));
    if (guildsWithMember.size === 0) return;

    for (const guild of guildsWithMember.values()) {
      const logChannel = await getGuildLogChannel(client, guild.id, 'activity');
      if (!logChannel) continue;

      if (oldUser.avatar !== newUser.avatar) {
        await logChannel.send({ embeds: [createAvatarChangeLogEmbed({ oldUser, newUser })] });
      }
      if (oldUser.username !== newUser.username) {
        await logChannel.send({ embeds: [createUsernameChangeLogEmbed({ oldUser, newUser, field: 'username' })] });
      }
      if (oldUser.globalName !== newUser.globalName) {
        await logChannel.send({ embeds: [createUsernameChangeLogEmbed({ oldUser, newUser, field: 'globalName' })] });
      }
    }
  } catch (error) {
    console.error('❌ Error registrando cambio de usuario:', error);
  }
}
