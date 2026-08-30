import { Events } from 'discord.js';
import { createVoiceLogEmbed } from '../utils/logEmbeds.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';
import { handleTempVoiceStateUpdate } from '../utils/tempVoiceEngine.js';
import { handleMusicVoiceStateUpdate } from '../utils/musicVoiceState.js';

export const name = Events.VoiceStateUpdate;
export const once = false;

export async function execute(oldState, newState, client) {
  // Salas de voz temporales (Join to Create): corre siempre, independiente de si el
  // logging de actividad está configurado — el early-return de abajo es solo para el
  // logging, no debe bloquear este sistema.
  await handleTempVoiceStateUpdate(oldState, newState).catch((error) => {
    console.error('❌ Error en el sistema de canales de voz temporales:', error);
  });

  // Sistema de música: detecta si el canal donde está tocando el bot se quedó sin
  // humanos, para desconectarse solo (ver musicVoiceState.js). Independiente del resto
  // de este handler, igual que el sistema de salas temporales de arriba.
  await handleMusicVoiceStateUpdate(oldState, newState).catch((error) => {
    console.error('❌ Error en el sistema de música (voiceStateUpdate):', error);
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
      // Mute/deafen/compartir pantalla NO se procesan a propósito — un usuario los
      // toca cientos de veces por sesión y no vale ni el query a guild_config
      // (getGuildLogChannel) ni el log por cada toque. Cámara queda fuera de este
      // recorte porque no se pidió sacarla.
      if (oldState.selfVideo !== newState.selfVideo) action = newState.selfVideo ? 'camera-on' : 'camera-off';
    }

    if (!action) return;

    const guildId = newState.guild?.id || oldState.guild?.id;
    if (!guildId) return;

    const logChannel = await getGuildLogChannel(client, guildId, 'activity');
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
