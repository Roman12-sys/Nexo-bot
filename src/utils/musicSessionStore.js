// Estado en memoria del sistema de música — un Map<guildId, session>, mismo patrón que
// roomStats (tempVoiceEngine.js) / guessSessions.js / giveTracker.js: nunca Supabase, se
// acepta perder la cola y la reproducción activa en un redeploy (ver CLAUDE.md, sección
// "Timers en memoria: qué persiste y qué no" — no hay ningún dato de música con valor de
// negocio que justifique persistirlo).
//
// Puramente data + matemática de cola: no importa nada de @discordjs/voice ni de
// youtube-dl-exec. musicEngine.js es quien setea session.connection/session.player/etc.
// (campos de runtime, sin validación) y quien orquesta destruirlos — acá solo vive el
// Map y las operaciones de negocio sobre la cola (con su propia validación/clamping).
// Mismo split que tempVoiceStore.js (data pura) / tempVoiceEngine.js (Discord + orquesta
// el borrado real).
const sessions = new Map();

export const MAX_QUEUE_SIZE = 200;
export const MIN_VOLUME = 0;
export const MAX_VOLUME = 200;
export const DEFAULT_VOLUME = 100;
export const LOOP_MODES = ['off', 'track', 'queue'];

export function hasSession(guildId) {
  return sessions.has(guildId);
}

export function getSession(guildId) {
  return sessions.get(guildId) || null;
}

// El caller (musicEngine.playRequest) debe chequear hasSession() antes — crear una
// sesión ya existente pisaría la cola/estado de una reproducción en curso.
export function createSession(guildId, { voiceChannelId, textChannel }) {
  const session = {
    guildId,
    voiceChannelId,
    // Objeto de canal completo (no solo el ID) — así los handlers de música (fin de
    // cola, error de reproducción, desconexión inesperada) pueden mandar un mensaje sin
    // necesitar una referencia aparte al client para hacer channels.fetch().
    textChannel,
    queue: [],
    current: null,
    loopMode: 'off',
    volume: DEFAULT_VOLUME,
    connection: null,
    player: null,
    resource: null,
    activeProcess: null,
    idleTimer: null,
    emptyChannelTimer: null,
    // Mensaje del panel de control (embed "reproduciendo ahora" + botones) que
    // musicEngine.js edita in-place ante cada cambio de estado — ver attachPanel() en
    // musicEngine.js. null hasta que /play manda la primera respuesta.
    panelMessage: null,
    createdAt: Date.now(),
  };
  sessions.set(guildId, session);
  return session;
}

// Borrado puro del registro — NO toca connection/player/activeProcess ni cancela
// timers. musicEngine.destroySession() es quien hace esa limpieza (mismo motivo, esos
// son objetos de @discordjs/voice/child_process, no data de este store) y recién
// después llama acá. Devuelve la sesión borrada (o null) para que el caller pueda
// limpiar lo que le corresponda.
export function deleteSession(guildId) {
  const session = sessions.get(guildId) || null;
  sessions.delete(guildId);
  return session;
}

export function addTrack(guildId, track) {
  const session = sessions.get(guildId);
  if (!session) return { ok: false, reason: 'no_session' };
  if (session.queue.length >= MAX_QUEUE_SIZE) return { ok: false, reason: 'queue_full' };
  session.queue.push(track);
  return { ok: true, position: session.queue.length };
}

// position es 1-indexado sobre la cola PENDIENTE (sin contar la canción actual), igual
// que se muestra en /queue. Devuelve la canción sacada, o null si la posición no existe.
export function removeTrack(guildId, position) {
  const session = sessions.get(guildId);
  if (!session) return null;
  const index = position - 1;
  if (index < 0 || index >= session.queue.length) return null;
  return session.queue.splice(index, 1)[0];
}

// Mezcla únicamente lo pendiente — la canción actual (session.current) nunca se toca,
// tal como se pidió explícitamente.
export function shufflePending(guildId) {
  const session = sessions.get(guildId);
  if (!session) return false;
  for (let i = session.queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [session.queue[i], session.queue[j]] = [session.queue[j], session.queue[i]];
  }
  return true;
}

export function clearQueue(guildId) {
  const session = sessions.get(guildId);
  if (!session) return false;
  session.queue = [];
  return true;
}

export function setLoopMode(guildId, mode) {
  const session = sessions.get(guildId);
  if (!session || !LOOP_MODES.includes(mode)) return false;
  session.loopMode = mode;
  return true;
}

export function setVolume(guildId, volume) {
  const session = sessions.get(guildId);
  if (!session) return false;
  session.volume = Math.min(MAX_VOLUME, Math.max(MIN_VOLUME, Math.round(volume)));
  return session.volume;
}

// Marca la canción actual como rota — musicEngine.js la llama cuando yt-dlp termina con
// error o el AudioPlayer emite 'error' reproduciéndola. Es la única forma de evitar un
// loop infinito de reintentos: sin esto, loop:'track' repetiría por siempre una canción
// que nunca va a poder reproducirse (mismo tipo de "consumo excesivo de CPU" que se
// pidió evitar explícitamente), y loop:'queue' la reencolaría para volver a fallar en la
// vuelta siguiente en vez de descartarla.
export function markCurrentTrackFailed(guildId) {
  const session = sessions.get(guildId);
  if (session?.current) session.current.failed = true;
}

// Decide y aplica cuál es la próxima canción a reproducir según el modo de loop, y deja
// session.current ya actualizado. Devuelve la nueva canción actual (o null si no queda
// nada para reproducir — el caller debe arrancar el idle timer en ese caso).
//
// 'track'  -> repite session.current tal cual (si no había nada sonando todavía, toma la
//             primera de la cola en su lugar).
// 'queue'  -> reencola session.current al final antes de tomar la próxima.
// 'off'    -> descarta session.current y toma la próxima.
//
// Una canción marcada .failed nunca se repite ni se reencola sin importar el modo de
// loop — se trata como si el loop estuviera apagado únicamente para esa transición.
export function advance(guildId) {
  const session = sessions.get(guildId);
  if (!session) return null;

  const finished = session.current;
  const honorLoop = finished && !finished.failed;

  if (session.loopMode === 'track' && honorLoop) {
    return finished;
  }

  if (session.loopMode === 'queue' && honorLoop) {
    session.queue.push(finished);
  }

  const next = session.queue.shift() || null;
  session.current = next;
  return next;
}

// Solo para tests — nunca se llama desde código de producción.
export function _resetAllSessionsForTests() {
  sessions.clear();
}
