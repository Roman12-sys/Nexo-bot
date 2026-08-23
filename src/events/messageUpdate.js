import { Events } from 'discord.js';
import { createMessageEditLogEmbed } from '../utils/logEmbeds.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';

export const name = Events.MessageUpdate;
export const once = false;

export async function execute(oldMessage, newMessage, client) {
  try {
    if (!newMessage.guild) return;
    if (newMessage.author?.bot) return;

    // Si alguno de los dos es partial no podemos comparar contenido de forma
    // confiable — mejor no loguear que loguear un falso "editado".
    if (oldMessage.partial || newMessage.partial) return;

    // Discord también dispara messageUpdate cuando solo agrega el embed de
    // link-preview a un mensaje sin que nadie haya tocado el texto: eso no
    // es una edición real y no debe loguearse.
    if (oldMessage.content === newMessage.content) return;

    const logChannel = await getGuildLogChannel(client, newMessage.guild.id, 'activity');
    if (!logChannel) return;

    const embed = createMessageEditLogEmbed({ oldMessage, newMessage, channel: newMessage.channel });
    await logChannel.send({ embeds: [embed] });
  } catch (error) {
    console.error('❌ Error registrando la edición de un mensaje:', error);
  }
}
