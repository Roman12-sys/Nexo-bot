import { Events } from 'discord.js';
import { createVoiceLogEmbed } from '../utils/logEmbeds.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';
import { handleTempVoiceStateUpdate } from '../utils/tempVoiceEngine.js';

export const name = Events.VoiceStateUpdate;
export const once = false;

export async function execute(oldState, newState, client) {
  // Salas de voz temporales (Join to Create): corre siempre, independiente de si el
  // logging de actividad está configurado — el early-return de abajo es solo para el
  // logging, no debe bloquear este sistema.
  await handleTempVoiceStateUpdate(oldState, newState).catch((error) => {
    console.error('❌ Error en el sistema de canales de voz temporales:', error);
  });

  try {
    const member = newState.member || oldState.member;
    if (!member) return;

    let action = null;
    if (oldState.channelId !== newState.channelId) {
      if (!oldState.channelId) action = 'join';
      else if (!newState.channelId) action = 'leave';
      else action = 'move';
    } else if (newState.channelId) {
      // Solo miramos estos cambios cuando el canal no cambió, para no
      // duplicar ruido con el join/leave/move de arriba.
      if (oldState.selfMute !== newState.selfMute) action = newState.selfMute ? 'mute' : 'unmute';
      else if (oldState.selfDeaf !== newState.selfDeaf) action = newState.selfDeaf ? 'deafen' : 'undeafen';
      else if (oldState.streaming !== newState.streaming) action = newState.streaming ? 'stream-start' : 'stream-stop';
      else if (oldState.selfVideo !== newState.selfVideo) action = newState.selfVideo ? 'camera-on' : 'camera-off';
    }

    if (!action) return;

    const logChannel = await getGuildLogChannel(client, newState.guild?.id || oldState.guild.id, 'activity');
    if (!logChannel) return;

    const embed = createVoiceLogEmbed({
      member,
      action,
      oldChannel: oldState.channel,
      newChannel: newState.channel,
    });
    await logChannel.send({ embeds: [embed] });
  } catch (error) {
    console.error('❌ Error registrando cambio de estado de voz:', error);
  }
}
