import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// musicEngine.js es el único módulo que toca @discordjs/voice — se mockea entero acá,
// con fakes mínimos que se comportan como el real lo suficiente para ejercitar el wiring
// de eventos (Idle/error/Disconnected) tal como lo hace musicEngine.js. musicSource.js
// (yt-dlp) también se mockea — nunca se spawnea un proceso real en los tests.
// musicSessionStore.js (la cola/matemática de loop) NO se mockea: ya tiene su propia
// batería de tests puros, y acá interesa la integración real entre motor y store.
const AudioPlayerStatus = { Idle: 'Idle', Playing: 'Playing', Paused: 'Paused', Buffering: 'Buffering' };
const VoiceConnectionStatus = { Disconnected: 'Disconnected', Signalling: 'Signalling', Connecting: 'Connecting', Ready: 'Ready', Destroyed: 'Destroyed' };
const NoSubscriberBehavior = { Pause: 'Pause' };
const StreamType = { Arbitrary: 'Arbitrary' };

function makeEmitterMock(extra = {}) {
  const handlers = new Map();
  const base = {
    on: vi.fn((event, cb) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(cb);
    }),
    removeAllListeners: vi.fn(() => handlers.clear()),
    _emit(event, ...args) {
      for (const cb of handlers.get(event) || []) cb(...args);
    },
  };
  return Object.assign(base, extra);
}

let lastConnection = null;
let lastPlayer = null;

const joinVoiceChannel = vi.fn(() => {
  lastConnection = makeEmitterMock({
    subscribe: vi.fn(),
    destroy: vi.fn(),
    state: { status: VoiceConnectionStatus.Ready },
  });
  return lastConnection;
});

const createAudioPlayer = vi.fn(() => {
  lastPlayer = makeEmitterMock({
    state: { status: AudioPlayerStatus.Idle },
    play: vi.fn(function play(resource) {
      this.state = { status: AudioPlayerStatus.Playing, resource };
    }),
    pause: vi.fn(function pause() {
      if (this.state.status !== AudioPlayerStatus.Playing) return false;
      this.state = { ...this.state, status: AudioPlayerStatus.Paused };
      return true;
    }),
    unpause: vi.fn(function unpause() {
      if (this.state.status !== AudioPlayerStatus.Paused) return false;
      this.state = { ...this.state, status: AudioPlayerStatus.Playing };
      return true;
    }),
    stop: vi.fn(function stop() {
      this.state = { status: AudioPlayerStatus.Idle };
      this._emit(AudioPlayerStatus.Idle);
      return true;
    }),
  });
  return lastPlayer;
});

const createAudioResource = vi.fn((stream, opts) => ({
  volume: opts?.inlineVolume ? { setVolume: vi.fn() } : undefined,
  playbackDuration: 0,
}));

const entersState = vi.fn(() => Promise.resolve());

vi.mock('@discordjs/voice', () => ({
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  NoSubscriberBehavior,
  StreamType,
}));

const resolveTrack = vi.fn();
const createTrackAudioStream = vi.fn();
const resolveAudioForKnownTrack = vi.fn();
class TrackNotFoundError extends Error {}
class TrackUnavailableError extends Error {}

vi.mock('../src/utils/musicSource.js', () => ({
  resolveTrack,
  resolveAudioForKnownTrack,
  createTrackAudioStream,
  TrackNotFoundError,
  TrackUnavailableError,
}));

// spotifyResolver.js también se mockea acá — musicEngine.js solo lo usa para el
// despacho (isSpotifyUrl) y para pedirle tracks normalizados; spotifyResolver.js ya
// tiene su propia batería de tests (tests/spotifyResolver.test.js) para su lógica
// interna real (auth, paginación, etc.).
const isSpotifyUrl = vi.fn(() => false);
const resolveSpotifyInput = vi.fn();
class SpotifyNotFoundError extends Error {}
class SpotifyUnavailableError extends Error {}
class SpotifyPrivateError extends Error {}

vi.mock('../src/utils/spotifyResolver.js', () => ({
  isSpotifyUrl,
  resolveSpotifyInput,
  SpotifyNotFoundError,
  SpotifyUnavailableError,
  SpotifyPrivateError,
}));

const store = await import('../src/utils/musicSessionStore.js');
const engine = await import('../src/utils/musicEngine.js');
// Importar musicEngine.js ya registró sus botones de panel en el router real (mismo
// router que usa interactionCreate.js en producción) — se ejercitan a través de él, no
// llamando funciones internas a mano, para probar el wiring completo.
const { routeButton } = await import('../src/components/buttons.js');

function makeTrack(overrides = {}) {
  return { title: 'Canción', url: 'https://example.com/x', durationSec: 200, requestedBy: { id: 'user-1' }, ...overrides };
}

function makeVoiceChannel(id = 'vc-1') {
  return { id, guild: { id: 'guild-1', voiceAdapterCreator: {} } };
}

function makeTextChannel() {
  return { id: 'tc-1', send: vi.fn().mockResolvedValue(undefined) };
}

function makeFakeProcess() {
  return { exitCode: null, killed: false, kill: vi.fn(), stderrTail: '' };
}

// El panel real vive en un canal que puede mandar mensajes nuevos (repostPanel) además
// de editar el existente (refreshPanel) -- el fake message viene con su propio channel
// mockeado, y channel.send() devuelve un mensaje fake nuevo que comparte el mismo
// channel, para poder encadenar varios reposts seguidos como pasaría de verdad.
function makeFakeChannel() {
  const channel = { send: vi.fn() };
  channel.send.mockImplementation(async () => makeFakeMessage(channel));
  return channel;
}

function makeFakeMessage(channel = makeFakeChannel()) {
  return { channel, edit: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined) };
}

function makeButtonInteraction(customId, { guildId = 'guild-1', userId = 'user-1', voiceChannelId = 'vc-1' } = {}) {
  return {
    customId,
    guildId,
    user: { id: userId },
    member: { voice: { channel: voiceChannelId ? { id: voiceChannelId } : null } },
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  store._resetAllSessionsForTests();
  vi.clearAllMocks();
  lastConnection = null;
  lastPlayer = null;
  resolveTrack.mockImplementation(async (query, requestedBy) => makeTrack({ title: query, requestedBy }));
  createTrackAudioStream.mockImplementation(() => ({ process: makeFakeProcess(), stream: {} }));
  entersState.mockImplementation(() => Promise.resolve());
  isSpotifyUrl.mockReturnValue(false); // por defecto ningún test es "una URL de Spotify" salvo que se pise explícito
});

afterEach(() => {
  vi.useRealTimers();
});

describe('playRequest — creación de sesión', () => {
  it('sin sesión previa: se conecta, crea el player y arranca a reproducir de inmediato', async () => {
    const result = await engine.playRequest({
      guildId: 'guild-1',
      voiceChannel: makeVoiceChannel(),
      textChannel: makeTextChannel(),
      query: 'una cancion',
      requestedByUserId: 'user-1',
      requestedByTag: 'user-1#0001',
    });

    expect(result.status).toBe('now_playing');
    expect(joinVoiceChannel).toHaveBeenCalledTimes(1);
    expect(joinVoiceChannel.mock.calls[0][0]).toMatchObject({ channelId: 'vc-1', guildId: 'guild-1' });
    expect(lastPlayer.play).toHaveBeenCalledTimes(1);
    expect(store.getSession('guild-1').current.title).toBe('una cancion');
  });

  it('con algo ya sonando: agrega a la cola en vez de reconectar', async () => {
    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'primera', requestedByUserId: 'u1' });
    const result = await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'segunda', requestedByUserId: 'u1' });

    expect(result.status).toBe('queued');
    expect(result.position).toBe(1);
    expect(joinVoiceChannel).toHaveBeenCalledTimes(1); // no se reconectó
    expect(store.getSession('guild-1').queue.map((t) => t.title)).toEqual(['segunda']);
  });

  it('rechaza reproducir en un canal de voz distinto al que ya está usando el bot en ese server', async () => {
    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel('vc-1'), textChannel: makeTextChannel(), query: 'primera', requestedByUserId: 'u1' });
    const result = await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel('vc-otro'), textChannel: makeTextChannel(), query: 'segunda', requestedByUserId: 'u1' });

    expect(result.status).toBe('error');
    expect(result.message).toMatch(/otro canal de voz/i);
    expect(store.getSession('guild-1').queue).toEqual([]); // no se tocó la cola real
  });

  it('canción no encontrada: no crea sesión ni se conecta', async () => {
    resolveTrack.mockRejectedValueOnce(new TrackNotFoundError('no existe'));
    const result = await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'algo raro', requestedByUserId: 'u1' });

    expect(result.status).toBe('error');
    expect(result.message).toBe('no existe');
    expect(joinVoiceChannel).not.toHaveBeenCalled();
    expect(store.hasSession('guild-1')).toBe(false);
  });

  it('dos servidores distintos nunca comparten sesión, cola ni conexión', async () => {
    await engine.playRequest({ guildId: 'guild-a', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'a', requestedByUserId: 'u1' });
    await engine.playRequest({ guildId: 'guild-b', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'b', requestedByUserId: 'u1' });

    expect(joinVoiceChannel).toHaveBeenCalledTimes(2);
    expect(store.getSession('guild-a').current.title).toBe('a');
    expect(store.getSession('guild-b').current.title).toBe('b');
    expect(store.getSession('guild-a').connection).not.toBe(store.getSession('guild-b').connection);
  });
});

describe('pause / resume', () => {
  it('pausa y reanuda respetando el estado real del player', async () => {
    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'x', requestedByUserId: 'u1' });
    const session = store.getSession('guild-1');

    expect(engine.pause(session)).toBe(true);
    expect(engine.pause(session)).toBe(false); // ya estaba pausado
    expect(engine.resume(session)).toBe(true);
    expect(engine.resume(session)).toBe(false); // ya estaba reproduciendo
  });
});

describe('skip', () => {
  it('avanza sola a la siguiente canción de la cola', async () => {
    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'primera', requestedByUserId: 'u1' });
    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'segunda', requestedByUserId: 'u1' });

    const session = store.getSession('guild-1');
    const skipped = engine.skip(session);

    expect(skipped.title).toBe('primera');
    expect(store.getSession('guild-1').current.title).toBe('segunda');
    expect(store.getSession('guild-1').queue).toEqual([]);
  });

  it('sin nada más en la cola, programa la desconexión por inactividad en vez de crashear', async () => {
    vi.useFakeTimers();
    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'única', requestedByUserId: 'u1' });
    const session = store.getSession('guild-1');

    engine.skip(session);
    expect(store.getSession('guild-1').current).toBeNull();
    expect(store.hasSession('guild-1')).toBe(true); // todavía no se desconectó

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(store.hasSession('guild-1')).toBe(false); // se desconectó solo
    expect(lastConnection.destroy).toHaveBeenCalled();
  });
});

describe('volume / loop / shuffle / remove', () => {
  it('setVolume clampea y aplica en vivo al resource actual', async () => {
    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'x', requestedByUserId: 'u1' });
    const session = store.getSession('guild-1');

    expect(engine.setVolume(session, 500)).toBe(200);
    expect(session.resource.volume.setVolume).toHaveBeenCalledWith(2);
  });

  it('shuffle nunca reordena la canción actual', async () => {
    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'actual', requestedByUserId: 'u1' });
    const session = store.getSession('guild-1');
    for (let i = 0; i < 5; i++) store.addTrack('guild-1', makeTrack({ title: `t${i}` }));

    engine.shuffle(session);
    expect(session.current.title).toBe('actual');
  });

  it('remove saca por posición y devuelve null si no existe', async () => {
    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'actual', requestedByUserId: 'u1' });
    const session = store.getSession('guild-1');
    store.addTrack('guild-1', makeTrack({ title: 'pendiente' }));

    expect(engine.remove(session, 1).title).toBe('pendiente');
    expect(engine.remove(session, 1)).toBeNull();
  });
});

describe('manejo de errores de reproducción', () => {
  it("yt-dlp termina con código de error: avisa por el canal y salta a la siguiente sin crashear", async () => {
    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'rota', requestedByUserId: 'u1' });
    const session = store.getSession('guild-1');
    store.addTrack('guild-1', makeTrack({ title: 'siguiente' }));

    session.activeProcess.exitCode = 1; // simula que yt-dlp murió con error
    lastPlayer._emit(AudioPlayerStatus.Idle); // fin "natural" del stream (vacío/truncado)

    expect(store.getSession('guild-1').current.title).toBe('siguiente');
    expect(session.textChannel.send).toHaveBeenCalledTimes(1);
    expect(session.textChannel.send.mock.calls[0][0].embeds).toBeDefined();
  });

  it("un track con loop:'track' que falla NO se repite (evita loop infinito) y avanza a la próxima", async () => {
    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'rota', requestedByUserId: 'u1' });
    const session = store.getSession('guild-1');
    store.setLoopMode('guild-1', 'track');
    store.addTrack('guild-1', makeTrack({ title: 'siguiente' }));

    session.activeProcess.exitCode = 1;
    lastPlayer._emit(AudioPlayerStatus.Idle);

    expect(store.getSession('guild-1').current.title).toBe('siguiente'); // no repitió "rota"
  });

  it('error del AudioPlayer: avisa una sola vez aunque también se detecte por el código de salida', async () => {
    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'rota', requestedByUserId: 'u1' });
    const session = store.getSession('guild-1');
    session.activeProcess.exitCode = 1;

    lastPlayer._emit('error', new Error('decode error'));
    lastPlayer._emit(AudioPlayerStatus.Idle);

    expect(session.textChannel.send).toHaveBeenCalledTimes(1); // no se duplicó el aviso
  });

  it('stream que nunca pudo crearse: no crashea, avisa y deja la sesión en estado idle', async () => {
    createTrackAudioStream.mockImplementationOnce(() => {
      throw new Error('spawn ENOENT');
    });
    const result = await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'rota', requestedByUserId: 'u1' });

    expect(result.status).toBe('now_playing'); // playRequest igual "arranca" — el fallo es async
    const session = store.getSession('guild-1');
    expect(session.textChannel.send).toHaveBeenCalledTimes(1);
    expect(session.current).toBeNull(); // no había nada más en cola -> avanzó a "nada"
  });
});

describe('reconexión de voz', () => {
  it('un blip de reconexión (vuelve a Signalling/Connecting) NO destruye la sesión', async () => {
    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'x', requestedByUserId: 'u1' });

    lastConnection._emit(VoiceConnectionStatus.Disconnected);
    await Promise.resolve(); // deja correr el microtask del handler async

    expect(store.hasSession('guild-1')).toBe(true);
    expect(lastConnection.destroy).not.toHaveBeenCalled();
  });

  it('una desconexión real (kick, canal borrado) SÍ limpia toda la sesión', async () => {
    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'x', requestedByUserId: 'u1' });
    entersState.mockImplementation(() => Promise.reject(new Error('timeout')));

    lastConnection._emit(VoiceConnectionStatus.Disconnected);
    await Promise.resolve();
    await Promise.resolve(); // deja resolver el Promise.race rechazado + el catch

    expect(store.hasSession('guild-1')).toBe(false);
    expect(lastConnection.destroy).toHaveBeenCalled();
  });
});

describe('destroySession — limpieza de recursos', () => {
  it('limpia listeners, mata el proceso activo, destruye la conexión y borra la sesión', async () => {
    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'x', requestedByUserId: 'u1' });
    const session = store.getSession('guild-1');
    const proc = session.activeProcess;

    engine.destroySession('guild-1');

    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
    expect(lastPlayer.removeAllListeners).toHaveBeenCalled();
    expect(lastConnection.removeAllListeners).toHaveBeenCalled();
    expect(lastConnection.destroy).toHaveBeenCalled();
    expect(store.hasSession('guild-1')).toBe(false);
  });

  it('sin announcement no manda ningún mensaje (el comando ya respondió)', async () => {
    const textChannel = makeTextChannel();
    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel, query: 'x', requestedByUserId: 'u1' });

    engine.destroySession('guild-1');
    expect(textChannel.send).not.toHaveBeenCalled();
  });

  it('con announcement manda el embed de desconexión al canal de texto de la sesión', async () => {
    const textChannel = makeTextChannel();
    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel, query: 'x', requestedByUserId: 'u1' });

    engine.destroySession('guild-1', 'motivo de prueba');
    expect(textChannel.send).toHaveBeenCalledTimes(1);
  });

  it('llamar destroySession sobre un guild sin sesión no explota', () => {
    expect(() => engine.destroySession('nadie')).not.toThrow();
  });
});

describe('panel de control — attachPanel/refreshPanel', () => {
  it('sin panel adjunto, ningún cambio de estado intenta editar nada (no explota)', async () => {
    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'x', requestedByUserId: 'u1' });
    const session = store.getSession('guild-1');
    expect(() => engine.pause(session)).not.toThrow();
  });

  it('pausar/reanudar edita el panel reflejando el nuevo estado', async () => {
    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'x', requestedByUserId: 'u1' });
    const session = store.getSession('guild-1');
    const panel = makeFakeMessage();
    engine.attachPanel(session, panel);

    engine.pause(session);
    expect(panel.edit).toHaveBeenCalledTimes(1);
    expect(panel.edit.mock.calls[0][0].components).toBeDefined();
  });

  it('saltar a la siguiente canción POSTEA un panel nuevo (no edita el viejo) para que no quede pegado arriba del canal', async () => {
    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'primera', requestedByUserId: 'u1' });
    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'segunda', requestedByUserId: 'u1' });
    const session = store.getSession('guild-1');
    const panel = makeFakeMessage();
    engine.attachPanel(session, panel);

    engine.skip(session);
    await Promise.resolve();
    await Promise.resolve();

    expect(panel.edit).not.toHaveBeenCalled(); // el viejo NUNCA se edita en un cambio de canción
    expect(panel.delete).toHaveBeenCalledTimes(1); // se borra
    expect(panel.channel.send).toHaveBeenCalledTimes(1); // se manda uno nuevo
    expect(session.panelMessage).not.toBe(panel); // la sesión ya apunta al mensaje nuevo
    const sentContent = panel.channel.send.mock.calls[0][0];
    expect(sentContent.components).not.toEqual([]); // sigue habiendo algo sonando -> panel completo
  });

  it('la cola se queda vacía: se postea el panel de "sin botones" (no se edita el que ya estaba)', async () => {
    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'única', requestedByUserId: 'u1' });
    const session = store.getSession('guild-1');
    const panel = makeFakeMessage();
    engine.attachPanel(session, panel);

    engine.skip(session);
    await Promise.resolve();
    await Promise.resolve();

    expect(panel.delete).toHaveBeenCalledTimes(1);
    const sentContent = panel.channel.send.mock.calls[0][0];
    expect(sentContent.components).toEqual([]);
  });

  it('agregar una canción a una cola que ya estaba sonando actualiza "En cola: N" in-place (no repostea, sigue la misma canción)', async () => {
    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'primera', requestedByUserId: 'u1' });
    const session = store.getSession('guild-1');
    const panel = makeFakeMessage();
    engine.attachPanel(session, panel);

    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'segunda', requestedByUserId: 'u1' });

    expect(panel.edit).toHaveBeenCalledTimes(1); // se editó el mismo mensaje
    expect(panel.channel.send).not.toHaveBeenCalled(); // no se posteó uno nuevo
    expect(session.panelMessage).toBe(panel);
  });

  it('destroySession deja el panel en su estado final sin botones', async () => {
    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'x', requestedByUserId: 'u1' });
    const session = store.getSession('guild-1');
    const panel = makeFakeMessage();
    engine.attachPanel(session, panel);

    engine.destroySession('guild-1', 'motivo');
    expect(panel.edit).toHaveBeenCalledWith(expect.objectContaining({ components: [] }));
  });
});

describe('botones del panel (routeButton)', () => {
  it('music_panel_toggle: pausa si estaba sonando, y responde con deferUpdate (sin mensaje nuevo)', async () => {
    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'x', requestedByUserId: 'u1' });
    const interaction = makeButtonInteraction('music_panel_toggle', { voiceChannelId: 'vc-1' });

    const handled = await routeButton(interaction);
    expect(handled).toBe(true);
    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(lastPlayer.state.status).toBe(AudioPlayerStatus.Paused);
  });

  it('un usuario en OTRO canal de voz no puede controlar el panel', async () => {
    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel('vc-1'), textChannel: makeTextChannel(), query: 'x', requestedByUserId: 'u1' });
    const interaction = makeButtonInteraction('music_panel_toggle', { voiceChannelId: 'vc-otro' });

    await routeButton(interaction);
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/mismo canal de voz/i) }));
    expect(lastPlayer.state.status).toBe(AudioPlayerStatus.Playing); // no se tocó nada
  });

  it('music_panel_skip llama al motor y avanza la cola', async () => {
    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'primera', requestedByUserId: 'u1' });
    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'segunda', requestedByUserId: 'u1' });

    await routeButton(makeButtonInteraction('music_panel_skip'));
    expect(store.getSession('guild-1').current.title).toBe('segunda');
  });

  it('music_panel_stop destruye la sesión', async () => {
    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'x', requestedByUserId: 'u1' });

    await routeButton(makeButtonInteraction('music_panel_stop'));
    expect(store.hasSession('guild-1')).toBe(false);
  });

  it('music_panel_loop cicla off -> track -> queue -> off', async () => {
    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'x', requestedByUserId: 'u1' });

    await routeButton(makeButtonInteraction('music_panel_loop'));
    expect(store.getSession('guild-1').loopMode).toBe('track');
    await routeButton(makeButtonInteraction('music_panel_loop'));
    expect(store.getSession('guild-1').loopMode).toBe('queue');
    await routeButton(makeButtonInteraction('music_panel_loop'));
    expect(store.getSession('guild-1').loopMode).toBe('off');
  });

  it('music_panel_queue responde efímero y no exige estar en el mismo canal', async () => {
    await engine.playRequest({ guildId: 'guild-1', voiceChannel: makeVoiceChannel(), textChannel: makeTextChannel(), query: 'x', requestedByUserId: 'u1' });
    const interaction = makeButtonInteraction('music_panel_queue', { voiceChannelId: null });

    const handled = await routeButton(interaction);
    expect(handled).toBe(true);
    expect(interaction.reply).toHaveBeenCalled();
  });

  it('sin sesión activa, cualquier botón responde con un error claro en vez de crashear', async () => {
    const interaction = makeButtonInteraction('music_panel_skip', { guildId: 'sin-sesion' });
    await routeButton(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/no hay ninguna reproducción/i) }));
  });
});

// Integración Spotify URL -> spotifyResolver -> track normalizado -> musicSource ->
// musicEngine, sin duplicar la lógica de reproducción (spotifyResolver.js está mockeado
// acá — su lógica interna real ya se prueba en tests/spotifyResolver.test.js; lo que
// importa acá es que musicEngine.js consuma su resultado correctamente).
function spotifyTrack(overrides = {}) {
  return {
    title: 'Nightcall',
    artist: 'Kavinsky',
    album: 'OutRun',
    durationSec: 257,
    thumbnail: null,
    isrc: null,
    source: 'spotify',
    sourceUrl: 'https://open.spotify.com/track/abc',
    requestedBy: { id: 'user-1' },
    addedAt: Date.now(),
    url: null, // sin fuente de audio todavía -- la resuelve musicSource, lazy
    ...overrides,
  };
}

describe('Spotify — integración con el pipeline existente', () => {
  it('track de Spotify: resuelve metadata, NUNCA usa esa url para el audio -- la consigue vía resolveAudioForKnownTrack (musicSource)', async () => {
    isSpotifyUrl.mockReturnValue(true);
    resolveSpotifyInput.mockResolvedValue({ type: 'track', name: 'Nightcall', tracks: [spotifyTrack()], totalCount: 1, skippedCount: 0 });
    resolveAudioForKnownTrack.mockResolvedValue({ url: 'https://youtube.com/watch?v=matched', isLive: false });

    const result = await engine.playRequest({
      guildId: 'guild-1',
      voiceChannel: makeVoiceChannel(),
      textChannel: makeTextChannel(),
      query: 'https://open.spotify.com/track/abc',
      requestedByUserId: 'user-1',
    });

    expect(result.status).toBe('now_playing');
    expect(resolveAudioForKnownTrack).toHaveBeenCalledWith(expect.objectContaining({ title: 'Nightcall', artist: 'Kavinsky' }));
    expect(createTrackAudioStream).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://youtube.com/watch?v=matched' }));
    expect(store.getSession('guild-1').current.source).toBe('spotify'); // la metadata de Spotify se conserva
    expect(store.getSession('guild-1').current.title).toBe('Nightcall');
  });

  it('playlist de Spotify: una sola respuesta resumida, agrega solo las válidas, y NO resuelve audio por adelantado para las que todavía no suenan', async () => {
    isSpotifyUrl.mockReturnValue(true);
    resolveSpotifyInput.mockResolvedValue({
      type: 'playlist',
      name: 'Synthwave hits',
      tracks: [spotifyTrack({ title: 'Nightcall' }), spotifyTrack({ title: 'Genesis' }), spotifyTrack({ title: 'Turbo Killer' })],
      totalCount: 5,
      skippedCount: 2,
    });
    resolveAudioForKnownTrack.mockResolvedValue({ url: 'https://youtube.com/watch?v=1', isLive: false });

    const result = await engine.playRequest({
      guildId: 'guild-1',
      voiceChannel: makeVoiceChannel(),
      textChannel: makeTextChannel(),
      query: 'https://open.spotify.com/playlist/xyz',
      requestedByUserId: 'user-1',
    });

    expect(result.status).toBe('spotify_batch');
    expect(result.type).toBe('playlist');
    expect(result.name).toBe('Synthwave hits');
    expect(result.totalCount).toBe(5);
    expect(result.addedCount).toBe(3);
    expect(result.skippedCount).toBe(2);

    const session = store.getSession('guild-1');
    expect(session.current.title).toBe('Nightcall'); // la primera arranca sola
    expect(session.queue.map((t) => t.title)).toEqual(['Genesis', 'Turbo Killer']); // el resto queda en cola, sin tocar

    // Clave: solo se resolvió audio para la que YA está sonando, no para las 3.
    expect(resolveAudioForKnownTrack).toHaveBeenCalledTimes(1);
  });

  it('álbum de Spotify se comporta igual que una playlist (mismo camino, distinto label)', async () => {
    isSpotifyUrl.mockReturnValue(true);
    resolveSpotifyInput.mockResolvedValue({
      type: 'album',
      name: 'OutRun',
      tracks: [spotifyTrack({ title: 'Nightcall' })],
      totalCount: 1,
      skippedCount: 0,
    });
    resolveAudioForKnownTrack.mockResolvedValue({ url: 'https://youtube.com/watch?v=1', isLive: false });

    const result = await engine.playRequest({
      guildId: 'guild-1',
      voiceChannel: makeVoiceChannel(),
      textChannel: makeTextChannel(),
      query: 'https://open.spotify.com/album/xyz',
      requestedByUserId: 'user-1',
    });

    expect(result.status).toBe('spotify_batch');
    expect(result.type).toBe('album');
  });

  it('maxTracks pasado al resolver respeta el espacio libre real de la cola', async () => {
    isSpotifyUrl.mockReturnValue(true);
    resolveSpotifyInput.mockResolvedValue({ type: 'playlist', name: 'X', tracks: [], totalCount: 0, skippedCount: 0 });

    // Sesión ya con 2 canciones en cola (+ 1 sonando) -- se arma a mano para no depender
    // de otro playRequest previo.
    store.createSession('guild-1', { voiceChannelId: 'vc-1', textChannel: makeTextChannel() });
    const existingSession = store.getSession('guild-1');
    existingSession.current = spotifyTrack({ title: 'actual' });
    store.addTrack('guild-1', spotifyTrack({ title: 'a' }));
    store.addTrack('guild-1', spotifyTrack({ title: 'b' }));
    existingSession.connection = joinVoiceChannel(); // para que ensureVoiceSession la reuse sin reconectar
    existingSession.player = createAudioPlayer();

    await engine.playRequest({
      guildId: 'guild-1',
      voiceChannel: makeVoiceChannel(),
      textChannel: makeTextChannel(),
      query: 'https://open.spotify.com/playlist/xyz',
      requestedByUserId: 'user-1',
    });

    const call = resolveSpotifyInput.mock.calls[0];
    expect(call[1].maxTracks).toBe(store.MAX_QUEUE_SIZE - 2);
  });

  it('error de Spotify (playlist privada, etc.): mensaje claro, nunca se conecta a voz', async () => {
    isSpotifyUrl.mockReturnValue(true);
    resolveSpotifyInput.mockRejectedValue(new SpotifyPrivateError('No puedo acceder a esa playlist de Spotify.'));

    const result = await engine.playRequest({
      guildId: 'guild-1',
      voiceChannel: makeVoiceChannel(),
      textChannel: makeTextChannel(),
      query: 'https://open.spotify.com/playlist/privada',
      requestedByUserId: 'user-1',
    });

    expect(result.status).toBe('error');
    expect(result.message).toBe('No puedo acceder a esa playlist de Spotify.');
    expect(joinVoiceChannel).not.toHaveBeenCalled();
  });

  it('la canción de Spotify sin fuente de audio disponible: avisa y NO crashea el resto de la cola', async () => {
    isSpotifyUrl.mockReturnValue(true);
    resolveSpotifyInput.mockResolvedValue({
      type: 'playlist',
      name: 'X',
      tracks: [spotifyTrack({ title: 'sin-match' }), spotifyTrack({ title: 'siguiente' })],
      totalCount: 2,
      skippedCount: 0,
    });
    resolveAudioForKnownTrack.mockRejectedValueOnce(new TrackUnavailableError('Encontré la canción, pero no pude obtener una fuente de reproducción.'));
    resolveAudioForKnownTrack.mockResolvedValueOnce({ url: 'https://youtube.com/watch?v=2', isLive: false });

    const textChannel = makeTextChannel();
    await engine.playRequest({
      guildId: 'guild-1',
      voiceChannel: makeVoiceChannel(),
      textChannel,
      query: 'https://open.spotify.com/playlist/xyz',
      requestedByUserId: 'user-1',
    });

    // handleTrackEnd avanza sola tras el fallo de resolución -- termina sonando "siguiente".
    expect(store.getSession('guild-1').current.title).toBe('siguiente');
    expect(textChannel.send).toHaveBeenCalled(); // avisó el fallo, no lo escondió
  });

  it('/queue, /skip, /pause tratan una canción de Spotify exactamente igual que cualquier otra -- no hay una "cola Spotify" aparte', async () => {
    isSpotifyUrl.mockReturnValue(true);
    resolveSpotifyInput.mockResolvedValue({ type: 'track', name: 'Nightcall', tracks: [spotifyTrack()], totalCount: 1, skippedCount: 0 });
    resolveAudioForKnownTrack.mockResolvedValue({ url: 'https://youtube.com/watch?v=1', isLive: false });

    await engine.playRequest({
      guildId: 'guild-1',
      voiceChannel: makeVoiceChannel(),
      textChannel: makeTextChannel(),
      query: 'https://open.spotify.com/track/abc',
      requestedByUserId: 'user-1',
    });

    const session = store.getSession('guild-1');
    expect(engine.pause(session)).toBe(true);
    expect(engine.resume(session)).toBe(true);
    const skipped = engine.skip(session);
    expect(skipped.source).toBe('spotify');
  });
});
