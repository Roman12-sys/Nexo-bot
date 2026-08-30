// Único módulo que toca @discordjs/voice. Orquesta: conexión de voz, AudioPlayer,
// avance de cola, reconexión, y limpieza de recursos. musicSessionStore.js es el Map de
// estado puro; este archivo es el "lado Discord", mismo split que
// tempVoiceStore.js/tempVoiceEngine.js.
import { MessageFlags } from 'discord.js';
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  NoSubscriberBehavior,
  StreamType,
} from '@discordjs/voice';
import * as musicSessionStore from './musicSessionStore.js';
import { resolveTrack, createTrackAudioStream, TrackNotFoundError, TrackUnavailableError } from './musicSource.js';
import {
  buildErrorEmbed,
  buildDisconnectedEmbed,
  buildQueueEmptyEmbed,
  buildNowPlayingEmbed,
  buildControlPanelRow,
  buildQueueEmbed,
  buildQueueRow,
} from './musicEmbeds.js';
import { requireActiveSession, requireActiveSessionInUserChannel } from './musicPermissions.js';
import { registerButtonPrefix } from '../components/buttons.js';

const IDLE_DISCONNECT_MS = 5 * 60 * 1000; // sin nada en cola durante 5 min -> se desconecta solo
const VOICE_READY_TIMEOUT_MS = 15_000;

function killActiveProcess(session) {
  const proc = session.activeProcess;
  session.activeProcess = null;
  if (proc && proc.exitCode === null && !proc.killed) {
    try {
      proc.kill('SIGKILL');
    } catch {
      // ya pudo haber muerto entre el chequeo y el kill — no es un error real
    }
  }
}

function clearIdleTimer(session) {
  if (session.idleTimer) {
    clearTimeout(session.idleTimer);
    session.idleTimer = null;
  }
}

function scheduleIdleDisconnect(session) {
  clearIdleTimer(session);
  session.idleTimer = setTimeout(() => {
    destroySession(session.guildId, '⏳ Se desconectó automáticamente: no había nada en la cola desde hace 5 minutos.');
  }, IDLE_DISCONNECT_MS).unref();
}

// Reconstruye el panel de control (embed "reproduciendo ahora" + botones) entero y lo
// edita in-place — se llama después de CUALQUIER cambio de estado relevante (cambio de
// canción, pausa/resume, volumen, loop, shuffle, cola). No hace nada si todavía no hay
// panel adjunto (recién /play lo adjunta después de mandar la primera respuesta) o si la
// sesión ya no tiene nada sonando (ahí se muestra el estado de "cola vacía" sin botones).
// Fire-and-forget: nunca se espera desde los callers, un panel que no se pudo editar
// (mensaje borrado a mano, etc.) no debe romper ninguna acción real.
function refreshPanel(session) {
  if (!session.panelMessage) return;

  if (!session.current) {
    session.panelMessage.edit({ embeds: [buildQueueEmptyEmbed()], components: [] }).catch(() => {});
    return;
  }

  const isPaused = session.player?.state?.status === AudioPlayerStatus.Paused;
  session.panelMessage
    .edit({
      embeds: [
        buildNowPlayingEmbed({
          track: session.current,
          loopMode: session.loopMode,
          volume: session.volume,
          queueLength: session.queue.length,
          playbackDurationMs: session.resource?.playbackDuration ?? 0,
        }),
      ],
      components: buildControlPanelRow({ isPaused, loopMode: session.loopMode }),
    })
    .catch(() => {});
}

// Idempotente por canción: si el mismo fallo dispara tanto el chequeo de código de
// salida de yt-dlp como el 'error' del AudioPlayer, solo se manda un mensaje.
function notifyPlaybackFailure(session, track) {
  if (!track || !session.textChannel) return Promise.resolve();
  if (session._lastFailureTrack === track) return Promise.resolve();
  session._lastFailureTrack = track;
  return session.textChannel
    .send({ embeds: [buildErrorEmbed(`No se pudo reproducir **${track.title}** — salteando a la siguiente.`)] })
    .catch(() => {});
}

// Único callback registrado en AudioPlayerStatus.Idle — corre tanto para un fin de
// canción normal como para uno fallido (ver el chequeo de exitCode abajo). Es el único
// lugar que llama a advance()/scheduleIdleDisconnect()/playTrack(), así nunca hay dos
// avances de cola compitiendo entre sí.
function handleTrackEnd(session) {
  const proc = session.activeProcess;
  if (proc && proc.exitCode !== null && proc.exitCode !== 0 && session.current && !session.current.failed) {
    console.error(`❌ [música] yt-dlp terminó con código ${proc.exitCode} reproduciendo "${session.current.title}":`, proc.stderrTail || '(sin salida)');
    musicSessionStore.markCurrentTrackFailed(session.guildId);
    notifyPlaybackFailure(session, session.current).catch(() => {});
  }

  killActiveProcess(session);
  session.resource = null;

  const next = musicSessionStore.advance(session.guildId);
  if (!next) {
    scheduleIdleDisconnect(session);
    refreshPanel(session);
    return;
  }
  playTrack(session, next).catch((error) => console.error('❌ [música] Error inesperado avanzando de canción:', error));
}

function handlePlayerError(session, error) {
  console.error(`❌ [música] Error del reproductor${session.current ? ` en "${session.current.title}"` : ''}:`, error);
  if (session.current && !session.current.failed) {
    musicSessionStore.markCurrentTrackFailed(session.guildId);
    notifyPlaybackFailure(session, session.current).catch(() => {});
  }
  // No se fuerza player.stop() acá: @discordjs/voice ya transiciona el player a Idle
  // solo después de emitir 'error', y ese Idle es el único que dispara handleTrackEnd
  // (evita el riesgo real de un doble avance si acá también se forzara el stop).
}

async function playTrack(session, track) {
  clearIdleTimer(session);

  let audio;
  try {
    audio = createTrackAudioStream(track);
  } catch (error) {
    console.error('❌ [música] Error creando el stream de audio:', error);
    musicSessionStore.markCurrentTrackFailed(session.guildId);
    await notifyPlaybackFailure(session, track);
    return handleTrackEnd(session);
  }

  session.activeProcess = audio.process;

  let resource;
  try {
    resource = createAudioResource(audio.stream, { inputType: StreamType.Arbitrary, inlineVolume: true });
  } catch (error) {
    console.error('❌ [música] Error creando el recurso de audio:', error);
    musicSessionStore.markCurrentTrackFailed(session.guildId);
    await notifyPlaybackFailure(session, track);
    return handleTrackEnd(session);
  }

  resource.volume?.setVolume(session.volume / 100);
  session.resource = resource;
  session.player.play(resource);
  refreshPanel(session);
}

async function connectVoice(guildId, voiceChannel) {
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: true,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, VOICE_READY_TIMEOUT_MS);
  } catch (error) {
    connection.destroy();
    throw error;
  }

  return connection;
}

function wireSession(session) {
  const { connection, player } = session;

  player.on(AudioPlayerStatus.Idle, () => handleTrackEnd(session));
  player.on('error', (error) => handlePlayerError(session, error));

  // Patrón oficial de @discordjs/voice para distinguir un blip de reconexión (ej. mover
  // al bot de canal) de una desconexión real (kick, canal borrado): una reconexión
  // real vuelve a pasar por Signalling/Connecting en pocos segundos; si no, se asume
  // perdida y se limpia todo.
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      destroySession(session.guildId, '📡 El bot se desconectó inesperadamente del canal de voz.');
    }
  });

  // Red de seguridad: si algo destruye la connection sin pasar por destroySession (no
  // debería pasar en un flujo normal), igual se limpia el registro para no dejar una
  // sesión fantasma ocupando el Map.
  connection.on(VoiceConnectionStatus.Destroyed, () => {
    if (musicSessionStore.getSession(session.guildId) === session) {
      musicSessionStore.deleteSession(session.guildId);
    }
  });
}

async function playNext(session) {
  const next = musicSessionStore.advance(session.guildId);
  if (!next) {
    scheduleIdleDisconnect(session);
    return;
  }
  await playTrack(session, next);
}

// --- API consumida por los comandos ---

export async function playRequest({ guildId, voiceChannel, textChannel, query, requestedByUserId, requestedByTag }) {
  let track;
  try {
    track = await resolveTrack(query, { id: requestedByUserId, tag: requestedByTag });
  } catch (error) {
    if (error instanceof TrackNotFoundError || error instanceof TrackUnavailableError) {
      return { status: 'error', message: error.message };
    }
    console.error('❌ [música] Error resolviendo canción:', error);
    return { status: 'error', message: 'Ocurrió un error buscando esa canción.' };
  }

  let session = musicSessionStore.getSession(guildId);
  if (session && session.voiceChannelId !== voiceChannel.id) {
    return { status: 'error', message: 'El bot ya está reproduciendo música en otro canal de voz de este servidor.' };
  }

  if (!session) {
    session = musicSessionStore.createSession(guildId, { voiceChannelId: voiceChannel.id, textChannel });
    try {
      const connection = await connectVoice(guildId, voiceChannel);
      session.connection = connection;
      session.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
      connection.subscribe(session.player);
      wireSession(session);
    } catch (error) {
      musicSessionStore.deleteSession(guildId);
      console.error('❌ [música] Error conectando al canal de voz:', error);
      return { status: 'error', message: 'No se pudo conectar al canal de voz (¿tiene permisos el bot?).' };
    }
  }

  const added = musicSessionStore.addTrack(guildId, track);
  if (!added.ok) {
    const message =
      added.reason === 'queue_full'
        ? `La cola ya tiene el máximo de ${musicSessionStore.MAX_QUEUE_SIZE} canciones.`
        : 'No se pudo agregar la canción a la cola.';
    return { status: 'error', message };
  }

  if (!session.current) {
    await playNext(session);
    return { status: 'now_playing', track, session };
  }

  return { status: 'queued', track, position: added.position, queueLength: session.queue.length, session };
}

export function pause(session) {
  if (!session.player || session.player.state.status !== AudioPlayerStatus.Playing) return false;
  const ok = session.player.pause();
  if (ok) refreshPanel(session);
  return ok;
}

export function resume(session) {
  if (!session.player || session.player.state.status !== AudioPlayerStatus.Paused) return false;
  const ok = session.player.unpause();
  if (ok) refreshPanel(session);
  return ok;
}

// Dispara Idle en el player (vía stop) -> handleTrackEnd hace el avance real, así nunca
// hay dos caminos de código decidiendo "cuál es la próxima canción".
export function skip(session) {
  const skipped = session.current;
  if (!session.player || !skipped) return null;
  session.player.stop(true);
  return skipped;
}

export function setVolume(session, level) {
  const clamped = musicSessionStore.setVolume(session.guildId, level);
  session.resource?.volume?.setVolume(clamped / 100);
  refreshPanel(session);
  return clamped;
}

export function setLoopMode(session, mode) {
  const ok = musicSessionStore.setLoopMode(session.guildId, mode);
  if (ok) refreshPanel(session);
  return ok;
}

export function shuffle(session) {
  musicSessionStore.shufflePending(session.guildId);
  refreshPanel(session);
  return session.queue.length;
}

export function remove(session, position) {
  const removed = musicSessionStore.removeTrack(session.guildId, position);
  if (removed) refreshPanel(session);
  return removed;
}

// Llamado por /play justo después de mandar la primera respuesta (el mensaje CON el
// panel) — a partir de acá, refreshPanel() ya tiene a qué mensaje editar en cada cambio
// de estado. `message` es el objeto Message real devuelto por interaction.editReply().
export function attachPanel(session, message) {
  session.panelMessage = message;
}

// Único punto de salida real de una sesión — lo llaman /stop, /disconnect, el idle
// timeout, el timeout de "canal vacío" (musicVoiceState.js) y la desconexión inesperada
// de arriba. `announcement`: si se pasa un string, se manda como embed al canal de texto
// de la sesión (para los casos disparados en background, sin un reply de interacción ya
// en curso); si se omite/null, se asume que quien llamó ya le va a responder al usuario
// directamente (evita mandar el mismo aviso dos veces desde /stop y /disconnect).
export function destroySession(guildId, announcement = null) {
  const session = musicSessionStore.getSession(guildId);
  if (!session) return;

  clearIdleTimer(session);
  if (session.emptyChannelTimer) {
    clearTimeout(session.emptyChannelTimer);
    session.emptyChannelTimer = null;
  }

  killActiveProcess(session);

  if (session.player) {
    session.player.removeAllListeners();
    try {
      session.player.stop(true);
    } catch {
      // ya pudo estar destruido
    }
  }
  if (session.connection) {
    session.connection.removeAllListeners();
    try {
      if (session.connection.state.status !== VoiceConnectionStatus.Destroyed) session.connection.destroy();
    } catch {
      // ya pudo estar destruido
    }
  }

  musicSessionStore.deleteSession(guildId);

  // El panel (si existe) es la forma preferida de avisar: se edita a su estado final
  // (motivo + sin botones, para que nadie clickee algo que ya no hace nada) en vez de
  // mandar un mensaje nuevo aparte. Solo se manda un mensaje nuevo si por algún motivo
  // nunca hubo panel adjunto (no debería pasar en un flujo normal).
  if (session.panelMessage) {
    session.panelMessage.edit({ embeds: [buildDisconnectedEmbed(announcement || 'Sesión finalizada.')], components: [] }).catch(() => {});
  } else if (announcement && session.textChannel) {
    session.textChannel.send({ embeds: [buildDisconnectedEmbed(announcement)] }).catch(() => {});
  }
}

// --- Panel de control: botones (ver musicEmbeds.js buildControlPanelRow) ---
// Nunca se confía en quién puede ver el botón — cada handler revalida "mismo canal de
// voz que el bot" igual que los comandos slash equivalentes (requireActiveSessionInUserChannel).
// deferUpdate() en vez de update(): la actualización visual real la hace refreshPanel()
// (ya encadenado dentro de pause/resume/skip/shuffle/setLoopMode) con su propio
// message.edit(), así hay un solo camino de código que construye el panel — nunca dos
// intentando escribir el mismo mensaje a la vez.

async function handlePanelToggle(interaction) {
  const { session, error } = requireActiveSessionInUserChannel(interaction);
  if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

  if (session.player?.state?.status === AudioPlayerStatus.Playing) pause(session);
  else resume(session);

  await interaction.deferUpdate();
}

async function handlePanelSkip(interaction) {
  const { session, error } = requireActiveSessionInUserChannel(interaction);
  if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

  skip(session);
  await interaction.deferUpdate();
}

async function handlePanelStop(interaction) {
  const { session, error } = requireActiveSessionInUserChannel(interaction);
  if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

  await interaction.deferUpdate();
  destroySession(session.guildId, `Detenido por <@${interaction.user.id}>.`);
}

async function handlePanelShuffle(interaction) {
  const { session, error } = requireActiveSessionInUserChannel(interaction);
  if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

  shuffle(session);
  await interaction.deferUpdate();
}

const NEXT_LOOP_MODE = { off: 'track', track: 'queue', queue: 'off' };

async function handlePanelLoopCycle(interaction) {
  const { session, error } = requireActiveSessionInUserChannel(interaction);
  if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

  setLoopMode(session, NEXT_LOOP_MODE[session.loopMode] || 'off');
  await interaction.deferUpdate();
}

// Solo lectura: no exige estar en el mismo canal que el bot, mismo criterio que /queue.
async function handlePanelQueue(interaction) {
  const { session, error } = requireActiveSession(interaction);
  if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

  const { embed, clampedPage, totalPages } = buildQueueEmbed(session, 0);
  await interaction.reply({ embeds: [embed], components: [buildQueueRow(clampedPage, totalPages)], flags: MessageFlags.Ephemeral });
}

registerButtonPrefix('music_panel_toggle', handlePanelToggle);
registerButtonPrefix('music_panel_skip', handlePanelSkip);
registerButtonPrefix('music_panel_stop', handlePanelStop);
registerButtonPrefix('music_panel_shuffle', handlePanelShuffle);
registerButtonPrefix('music_panel_loop', handlePanelLoopCycle);
registerButtonPrefix('music_panel_queue', handlePanelQueue);
