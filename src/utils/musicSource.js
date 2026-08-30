// Único punto de contacto con yt-dlp (vía youtube-dl-exec). Ver CLAUDE.md / el plan de
// esta feature para la investigación completa de por qué yt-dlp y no ytdl-core/play-dl.
//
// QUÉ CAMBIÓ (respecto al patrón "obvio" de usar youtubedl.exec() para todo): para el
// STREAMING de audio (createTrackAudioStream) esto NO usa youtubedl.exec(). MOTIVO real,
// encontrado leyendo el código fuente de youtube-dl-exec/tinyspawn (no es una suposición):
// tinyspawn (la lib que usa youtube-dl-exec por dentro) engancha su PROPIO listener
// 'data' sobre childProcess.stdout apenas spawnea el proceso, para poder devolver la
// salida como texto/JSON cuando termina — eso significa que CUALQUIER uso de
// youtubedl.exec() bufferea absolutamente toda la salida en un array en memoria hasta
// que el proceso termina, sin importar qué pipe le pongamos nosotros encima. Para
// `--dump-json` (unos KB de texto) es exactamente el diseño correcto. Para el audio de
// una canción completa (varios MB, streameados) sería un memory leak real por canción
// reproducida — justo lo que se pidió evitar. Por eso acá se spawnea el binario de
// yt-dlp DIRECTO con child_process (usando la misma ruta que youtube-dl-exec ya
// descarga/gestiona, youtubedl.constants.YOUTUBE_DL_PATH), y youtubedl() normal (con su
// buffering) se usa solo para resolveTrack(), que es puro texto corto.
import { spawn } from 'node:child_process';
import youtubedl from 'youtube-dl-exec';

const YT_DLP_BINARY = youtubedl.constants.YOUTUBE_DL_PATH;
const METADATA_TIMEOUT_MS = 15_000;

export class TrackNotFoundError extends Error {}
export class TrackUnavailableError extends Error {}

function classifyExtractionError(error, isUrl) {
  const message = String(error?.stderr || error?.message || '');

  if (/private video|sign in to confirm|age.restricted/i.test(message)) {
    return new TrackUnavailableError('Ese video es privado o tiene restricción de edad — no se puede reproducir.');
  }
  if (/video unavailable|has been removed|no longer available|this video is not available/i.test(message)) {
    return new TrackUnavailableError('Ese video ya no está disponible (puede haber sido eliminado).');
  }
  if (/unsupported url|is not a valid url/i.test(message)) {
    return new TrackNotFoundError('Esa URL no es compatible.');
  }
  if (error?.killed || /timed out|etimedout/i.test(message)) {
    return new TrackUnavailableError('La búsqueda tardó demasiado — probá de nuevo en un rato.');
  }
  return isUrl
    ? new TrackUnavailableError('No se pudo obtener esa URL (puede ser un problema temporal del extractor).')
    : new TrackNotFoundError('No se encontraron resultados para esa búsqueda.');
}

// query puede ser una URL (YouTube y, gracias a yt-dlp, cientos de sitios más) o texto
// libre — en ese caso se busca con ytsearch1: (yt-dlp resuelve la búsqueda solo, sin
// depender de ningún paquete de búsqueda aparte).
export async function resolveTrack(query, requestedBy) {
  const trimmed = query.trim();
  const isUrl = /^https?:\/\//i.test(trimmed);
  const target = isUrl ? trimmed : `ytsearch1:${trimmed}`;

  let result;
  try {
    result = await youtubedl(
      target,
      {
        dumpSingleJson: true,
        noWarnings: true,
        noPlaylist: true,
        socketTimeout: 10,
        retries: 3,
      },
      { timeout: METADATA_TIMEOUT_MS },
    );
  } catch (error) {
    throw classifyExtractionError(error, isUrl);
  }

  // ytsearchN: (y algunas URLs de playlist) devuelven un contenedor { entries: [...] }
  // en vez de un objeto de video directo — se cubren ambas formas.
  const info = result && Array.isArray(result.entries) ? result.entries[0] : result;
  if (!info || !info.title) {
    throw new TrackNotFoundError(
      isUrl ? 'No se pudo obtener información de esa URL.' : `No se encontraron resultados para "${trimmed}".`,
    );
  }

  return {
    title: info.title,
    url: info.webpage_url || info.original_url || target,
    durationSec: typeof info.duration === 'number' ? info.duration : null,
    isLive: Boolean(info.is_live),
    thumbnail: info.thumbnail || null,
    uploader: info.uploader || info.channel || null,
    requestedBy,
    addedAt: Date.now(),
  };
}

// Spawnea yt-dlp para UNA sola canción (la que se está por reproducir ya mismo, nunca
// toda la cola por adelantado) y devuelve su stdout crudo, listo para
// createAudioResource. El caller (musicEngine.js) es responsable de matar el proceso
// (process.kill()) al hacer skip/stop/destroySession — acá no se hace ninguna limpieza
// automática por tiempo, ese ciclo de vida lo maneja la sesión.
export function createTrackAudioStream(track) {
  const proc = spawn(
    YT_DLP_BINARY,
    [track.url, '-f', 'bestaudio/best', '--no-playlist', '--no-warnings', '--quiet', '--socket-timeout', '10', '--retries', '3', '-o', '-'],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );

  // Guarda solo los últimos ~4KB de stderr para poder loguear algo útil si el proceso
  // falla antes de producir audio — nunca se imprime nada de esto si todo sale bien
  // (evita el spam de logs que se pidió evitar). Se cuelga directo del ChildProcess
  // (no en un closure aparte) para que musicEngine.js pueda leerlo después solo con la
  // referencia al proceso, sin tener que guardar el wrapper completo en la sesión.
  proc.stderrTail = '';
  proc.stderr.on('data', (chunk) => {
    proc.stderrTail = (proc.stderrTail + chunk.toString()).slice(-4000);
  });

  // Sin estos dos listeners, un fallo de spawn (ej. el binario no existe) o un error del
  // lado del stream (ej. EPIPE) sería un 'error' de EventEmitter sin oyentes -> excepción
  // no capturada -> tira todo el proceso del bot (ver el handler global de
  // uncaughtException en index.js). musicEngine.js agrega sus propios listeners además
  // de estos; un EventEmitter admite varios sin problema.
  proc.on('error', (error) => {
    console.error('❌ [música] No se pudo iniciar yt-dlp:', error);
  });
  proc.stdout.on('error', () => {});

  return { process: proc, stream: proc.stdout };
}

// Chequeo liviano de arranque (ready.js) — nunca tira, siempre resuelve. Sirve para que
// un yt-dlp roto/ausente quede en los logs de Railway apenas arranca el proceso, en vez
// de que el primer indicio sea un usuario reportando que /play no funciona.
export function checkBinaryAvailable() {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(YT_DLP_BINARY, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 10_000 });
    } catch {
      resolve({ ok: false });
      return;
    }
    let out = '';
    proc.stdout.on('data', (chunk) => {
      out += chunk.toString();
    });
    proc.on('error', () => resolve({ ok: false }));
    proc.on('exit', (code) => resolve({ ok: code === 0, version: out.trim() }));
  });
}
