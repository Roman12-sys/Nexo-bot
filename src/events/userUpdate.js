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
    // Se arman los embeds UNA sola vez (no dependen del guild, el cambio es el mismo
    // para todos) y se mandan juntos en un solo send por guild — antes eran hasta 3
    // sends separados por guild, y alguien en varios servidores mutuos con el bot podía
    // multiplicar eso bastante para un solo cambio de perfil.
    const embeds = [];
    if (oldUser.avatar !== newUser.avatar) embeds.push(createAvatarChangeLogEmbed({ oldUser, newUser }));
    if (oldUser.username !== newUser.username) embeds.push(createUsernameChangeLogEmbed({ oldUser, newUser, field: 'username' }));
    if (oldUser.globalName !== newUser.globalName) embeds.push(createUsernameChangeLogEmbed({ oldUser, newUser, field: 'globalName' }));
    if (embeds.length === 0) return;

    const guildsWithMember = client.guilds.cache.filter((guild) => guild.members.cache.has(newUser.id));
    if (guildsWithMember.size === 0) return;

    for (const guild of guildsWithMember.values()) {
      const logChannel = await getGuildLogChannel(client, guild.id, 'activity');
      if (!logChannel) continue;
      await logChannel.send({ embeds });
    }
  } catch (error) {
    console.error('❌ Error registrando cambio de usuario:', error);
  }
}
