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
import { resolveTrack, resolveAudioForKnownTrack, createTrackAudioStream, TrackNotFoundError, TrackUnavailableError } from './musicSource.js';
import { isSpotifyUrl, resolveSpotifyInput, SpotifyNotFoundError, SpotifyUnavailableError, SpotifyPrivateError } from './spotifyResolver.js';
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

// Arma el contenido del panel (embed + botones) para el estado actual de la sesión —
// compartido por refreshPanel (edita in-place) y repostPanel (manda uno nuevo). Nunca
// decide solo cuál de los dos usar, eso lo decide cada caller según si lo que cambió fue
// la canción o no (ver comentarios de cada función más abajo).
function buildPanelContent(session) {
  if (!session.current) {
    return { embeds: [buildQueueEmptyEmbed()], components: [] };
  }

  const isPaused = session.player?.state?.status === AudioPlayerStatus.Paused;
  return {
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
  };
}

// Edita el panel EN EL MISMO mensaje — para cambios de estado que no son "cambió la
// canción" (pausa/resume, volumen, loop, shuffle, cola). Fire-and-forget: nunca se
// espera desde los callers, un panel que no se pudo editar (mensaje borrado a mano,
// etc.) no debe romper ninguna acción real.
function refreshPanel(session) {
  if (!session.panelMessage) return;
  session.panelMessage.edit(buildPanelContent(session)).catch(() => {});
}

// Borra el mensaje viejo del panel y manda uno nuevo — para cuando SÍ cambió la canción
// (avance de cola, sea normal o por skip/falla) o la sesión termina. Sin esto, el panel
// se queda pegado en el mismo punto del canal desde el primer /play, y con actividad
// normal del server termina enterrado arriba — reenviarlo lo trae siempre al final,
// mismo criterio "un solo mensaje a la vez" que ya tenía (nunca dos paneles vivos), solo
// que ese "uno" se mueve con la conversación en vez de editarse ad infinitum en el mismo
// lugar. No se llama en cada click de botón a propósito (pausar/volumen/etc. sí editan
// in-place) — spamear un mensaje nuevo por cada uno sería justo el ruido que se pidió
// evitar.
async function repostPanel(session) {
  const oldMessage = session.panelMessage;
  if (!oldMessage) return;

  const channel = oldMessage.channel;
  if (!channel) {
    refreshPanel(session);
    return;
  }

  try {
    session.panelMessage = await channel.send(buildPanelContent(session));
  } catch (error) {
    console.error('❌ [música] Error posteando el panel de nuevo:', error);
    return;
  }

  oldMessage.delete().catch(() => {}); // ya se mandó el nuevo -- si falla borrar el viejo, no es grave
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
    repostPanel(session).catch((error) => console.error('❌ [música] Error reposteando el panel (cola vacía):', error));
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

  // Genérico, no específico de Spotify: cualquier track que llegue sin url propia
  // (hoy, solo los que vienen de spotifyResolver.js) recién consigue su fuente de audio
  // ACÁ, cuando le toca sonar de verdad — nunca por adelantado para toda la cola. Así
  // agregar una playlist de 50 canciones no dispara 50 procesos yt-dlp de una.
  if (!track.url) {
    try {
      const resolved = await resolveAudioForKnownTrack(track);
      track.url = resolved.url;
      track.isLive = resolved.isLive;
    } catch (error) {
      console.error(`❌ [música] No se pudo resolver audio para "${track.title}":`, error.message);
      musicSessionStore.markCurrentTrackFailed(session.guildId);
      await notifyPlaybackFailure(session, track);
      return handleTrackEnd(session);
    }
  }

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
  // Cambió la canción -> el panel se repostea (no se edita) para que no quede pegado
  // arriba del todo del canal a medida que pasa el tiempo. Sin panel adjunto todavía
  // (la primerísima canción de /play, antes de que play.js llame a attachPanel) esto
  // no hace nada -- mismo no-op que tenía refreshPanel acá antes.
  repostPanel(session).catch((error) => console.error('❌ [música] Error reposteando el panel:', error));
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

// Compartido por el camino normal y el de Spotify: "si no hay sesión, creála y conectate
// a voz; si ya hay una, verificá que sea el mismo canal". Antes vivía inline dentro de
// playRequest — se extrajo para no duplicarlo en playFromSpotify.
async function ensureVoiceSession(guildId, voiceChannel, textChannel) {
  let session = musicSessionStore.getSession(guildId);
  if (session && session.voiceChannelId !== voiceChannel.id) {
    return { error: 'El bot ya está reproduciendo música en otro canal de voz de este servidor.' };
  }
  if (session) return { session };

  session = musicSessionStore.createSession(guildId, { voiceChannelId: voiceChannel.id, textChannel });
  try {
    const connection = await connectVoice(guildId, voiceChannel);
    session.connection = connection;
    session.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    connection.subscribe(session.player);
    wireSession(session);
    return { session };
  } catch (error) {
    musicSessionStore.deleteSession(guildId);
    console.error('❌ [música] Error conectando al canal de voz:', error);
    return { error: 'No se pudo conectar al canal de voz (¿tiene permisos el bot?).' };
  }
}

// --- API consumida por los comandos ---

export async function playRequest({ guildId, voiceChannel, textChannel, query, requestedByUserId, requestedByTag }) {
  const requestedBy = { id: requestedByUserId, tag: requestedByTag };

  // Único punto de despacho — toda la lógica real de Spotify vive en spotifyResolver.js
  // y playFromSpotify(), acá es un solo if.
  if (isSpotifyUrl(query)) {
    return playFromSpotify({ guildId, voiceChannel, textChannel, query, requestedBy });
  }

  let track;
  try {
    track = await resolveTrack(query, requestedBy);
  } catch (error) {
    if (error instanceof TrackNotFoundError || error instanceof TrackUnavailableError) {
      return { status: 'error', message: error.message };
    }
    console.error('❌ [música] Error resolviendo canción:', error);
    return { status: 'error', message: 'Ocurrió un error buscando esa canción.' };
  }

  const { session, error } = await ensureVoiceSession(guildId, voiceChannel, textChannel);
  if (error) return { status: 'error', message: error };

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

  // No cambió la canción, pero sí el "En cola: N" del panel -- se edita in-place (no se
  // repostea, seguimos en la misma canción).
  refreshPanel(session);
  return { status: 'queued', track, position: added.position, queueLength: session.queue.length, session };
}

// Spotify SOLO aporta identificación/metadata acá — el audio real sigue viniendo de
// resolveAudioForKnownTrack() (musicSource.js/yt-dlp), resuelto lazy en playTrack() para
// cada canción recién cuando le toca sonar. Nunca se extrae ni retransmite audio de
// Spotify de ninguna forma.
async function playFromSpotify({ guildId, voiceChannel, textChannel, query, requestedBy }) {
  const existing = musicSessionStore.getSession(guildId);
  const maxTracks = Math.max(0, musicSessionStore.MAX_QUEUE_SIZE - (existing ? existing.queue.length : 0));

  let resolved;
  try {
    resolved = await resolveSpotifyInput(query, { requestedBy, maxTracks });
  } catch (error) {
    if (error instanceof SpotifyNotFoundError || error instanceof SpotifyUnavailableError || error instanceof SpotifyPrivateError) {
      return { status: 'error', message: error.message };
    }
    console.error('❌ [música] Error resolviendo enlace de Spotify:', error);
    return { status: 'error', message: 'Ocurrió un error consultando Spotify.' };
  }

  if (resolved.tracks.length === 0) {
    return {
      status: 'error',
      message: resolved.type === 'track' ? 'Esa canción no está disponible.' : 'No encontré canciones disponibles para agregar de esa playlist/álbum.',
    };
  }

  const { session, error } = await ensureVoiceSession(guildId, voiceChannel, textChannel);
  if (error) return { status: 'error', message: error };

  if (resolved.type === 'track') {
    const track = resolved.tracks[0];
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
    refreshPanel(session);
    return { status: 'queued', track, position: added.position, queueLength: session.queue.length, session };
  }

  // Playlist o álbum: una sola respuesta resumida, nunca un mensaje por canción.
  let addedCount = 0;
  for (const track of resolved.tracks) {
    if (musicSessionStore.addTrack(guildId, track).ok) addedCount++;
  }

  if (!session.current) {
    await playNext(session); // arranca sola -> playTrack ya repostea el panel
  } else {
    refreshPanel(session); // seguía sonando lo mismo, solo cambió "En cola: N"
  }

  return {
    status: 'spotify_batch',
    type: resolved.type,
    name: resolved.name,
    totalCount: resolved.totalCount,
    addedCount,
    skippedCount: resolved.skippedCount,
    session,
  };
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
