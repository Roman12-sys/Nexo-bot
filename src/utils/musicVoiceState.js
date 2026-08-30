// Disparado desde events/voiceStateUpdate.js, igual que handleTempVoiceStateUpdate —
// mismo patrón de "gracia" que pendingEmptyChecks en tempVoiceEngine.js, pero para el
// canal de voz donde está tocando música: si se queda sin humanos, se programa una
// desconexión con margen (por si alguien vuelve a entrar enseguida); si vuelve a haber
// alguien antes de que se cumpla, se cancela.
import { destroySession } from './musicEngine.js';
import { getSession } from './musicSessionStore.js';

const EMPTY_CHANNEL_DISCONNECT_MS = 60 * 1000;

export async function handleMusicVoiceStateUpdate(oldState, newState) {
  const guild = newState.guild || oldState.guild;
  if (!guild) return;

  const session = getSession(guild.id);
  if (!session) return;

  // Solo importa si el cambio ocurrió justo en el canal donde está conectado el bot.
  const relevantChannelId = session.voiceChannelId;
  if (oldState.channelId !== relevantChannelId && newState.channelId !== relevantChannelId) return;

  const channel =
    (newState.channelId === relevantChannelId ? newState.channel : oldState.channel) ||
    (await guild.channels.fetch(relevantChannelId).catch(() => null));
  if (!channel) return;

  const hasHumans = channel.members.some((member) => !member.user.bot);

  if (!hasHumans) {
    if (session.emptyChannelTimer) return; // ya hay uno programado
    session.emptyChannelTimer = setTimeout(() => {
      session.emptyChannelTimer = null;
      destroySession(guild.id, '👋 Se desconectó automáticamente: el canal de voz quedó vacío.');
    }, EMPTY_CHANNEL_DISCONNECT_MS).unref();
  } else if (session.emptyChannelTimer) {
    clearTimeout(session.emptyChannelTimer);
    session.emptyChannelTimer = null;
  }
}
