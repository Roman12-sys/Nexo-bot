// Único módulo que sabe que Spotify existe — nadie más en el sistema de música importa
// nada de acá salvo isSpotifyUrl()/resolveSpotifyInput() desde musicEngine.js. Spotify
// es EXCLUSIVAMENTE una fuente de identificación/metadata: este archivo nunca extrae,
// descarga ni retransmite audio de Spotify de ninguna forma (nada de Web Playback SDK,
// nada de APIs no oficiales de streaming). El audio real lo sigue resolviendo yt-dlp vía
// musicSource.resolveAudioForKnownTrack(), exactamente como cualquier otra canción.
//
// Investigación (WebFetch sobre developer.spotify.com, 2026-08-30) — hallazgo real que
// vale la pena dejar documentado acá: Spotify cambió su política de Web API en febrero
// 2026. Toda app nueva en "Developer Mode" (el modo por default) exige que el dueño
// tenga Spotify Premium activo para que la app siga funcionando. También documentan un
// límite de "5 usuarios" para Developer Mode — no queda claro en la documentación
// oficial si eso aplica a Client Credentials Flow (el que se usa acá: server-to-server,
// sin login de ningún usuario de Spotify) o solo a flujos con autorización de usuario
// individual. Como Client Credentials no tiene noción de "usuario autorizado", lo más
// probable es que no aplique, pero es una incertidumbre real de la plataforma, no de
// esta implementación. Además, `external_ids` (que trae el ISRC) fue removido de varias
// respuestas en este mismo cambio — el campo isrc de acá va a venir null la mayoría de
// las veces en la práctica.
import { config } from '../config.js';
import { withLock } from './asyncLock.js';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com/v1';
const TOKEN_REFRESH_BUFFER_MS = 60_000;
const MAX_RETRY_AFTER_MS = 3_000; // más que esto, se falla en vez de colgar la interacción
const PAGE_LIMIT = 50;

const SPOTIFY_URL_RE = /^https?:\/\/(?:open\.)?spotify\.com\/(?:intl-[a-z]{2}\/)?(track|playlist|album)\/([A-Za-z0-9]+)(?:[/?].*)?$/i;

export class SpotifyNotFoundError extends Error {}
export class SpotifyUnavailableError extends Error {}
export class SpotifyPrivateError extends Error {}

export function isSpotifyUrl(input) {
  return typeof input === 'string' && SPOTIFY_URL_RE.test(input.trim());
}

function parseSpotifyUrl(input) {
  const match = input.trim().match(SPOTIFY_URL_RE);
  if (!match) return null;
  return { type: match[1], id: match[2] };
}

// --- Auth (Client Credentials Flow) ---

let tokenCache = null; // { accessToken, expiresAt }

async function fetchNewToken() {
  if (!config.spotifyClientId || !config.spotifyClientSecret) {
    throw new SpotifyUnavailableError('Spotify no está configurado en este bot.');
  }

  const basic = Buffer.from(`${config.spotifyClientId}:${config.spotifyClientSecret}`).toString('base64');
  let response;
  try {
    response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
  } catch (error) {
    console.error('❌ [música/spotify] Error de red pidiendo el token:', error);
    throw new SpotifyUnavailableError('No pude consultar Spotify en este momento.');
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    console.error(`❌ [música/spotify] Spotify rechazó la autenticación (status ${response.status}):`, bodyText.slice(0, 500));
    throw new SpotifyUnavailableError('No pude consultar Spotify en este momento.');
  }

  const data = await response.json();
  return { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 - TOKEN_REFRESH_BUFFER_MS };
}

// Cacheado en memoria — nunca se autentica contra Spotify en cada /play. withLock evita
// que N pedidos simultáneos (varios usuarios usando Spotify a la vez) disparen N
// renovaciones de token en paralelo — mismo patrón que ya usa tempVoiceEngine.js.
async function getAccessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.accessToken;

  return withLock('spotify_token', async () => {
    if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.accessToken; // otro caller ya renovó mientras esperábamos
    tokenCache = await fetchNewToken();
    return tokenCache.accessToken;
  });
}

// --- HTTP ---

// pathOrUrl acepta tanto un path relativo ("/tracks/ID") como una URL absoluta (el
// campo `next` de paginación de Spotify siempre viene como URL completa).
async function spotifyFetch(pathOrUrl, { notFoundMessage, privateMessage, retriedAuth = false, retried429 = false } = {}) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${API_BASE}${pathOrUrl}`;
  const token = await getAccessToken();

  let response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (error) {
    console.error(`❌ [música/spotify] Error de red consultando ${url}:`, error);
    throw new SpotifyUnavailableError('No pude consultar Spotify en este momento.');
  }

  // Token vencido/inválido a mitad de camino (poco común dado el cache, pero real) — se
  // fuerza una renovación y se reintenta UNA sola vez, nunca en loop.
  if (response.status === 401 && !retriedAuth) {
    tokenCache = null;
    return spotifyFetch(pathOrUrl, { notFoundMessage, privateMessage, retriedAuth: true, retried429 });
  }
  if (response.status === 401) {
    console.error(`❌ [música/spotify] Sigue dando 401 después de renovar el token para ${url} — revisá SPOTIFY_CLIENT_ID/SECRET en Railway.`);
    throw new SpotifyUnavailableError('No pude consultar Spotify en este momento.');
  }

  if (response.status === 429 && !retried429) {
    const retryAfterSec = Number(response.headers.get('retry-after')) || 1;
    if (retryAfterSec * 1000 <= MAX_RETRY_AFTER_MS) {
      await new Promise((resolve) => setTimeout(resolve, retryAfterSec * 1000));
      return spotifyFetch(pathOrUrl, { notFoundMessage, privateMessage, retriedAuth, retried429: true });
    }
    throw new SpotifyUnavailableError('Spotify está limitando las consultas — probá de nuevo en un rato.');
  }
  if (response.status === 429) throw new SpotifyUnavailableError('Spotify está limitando las consultas — probá de nuevo en un rato.');

  if (response.status === 403) throw new SpotifyPrivateError(privateMessage || 'No puedo acceder a eso en Spotify.');
  if (response.status === 404) throw new SpotifyNotFoundError(notFoundMessage || 'No encontré eso en Spotify.');
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    console.error(`❌ [música/spotify] Spotify devolvió status ${response.status} para ${url}:`, bodyText.slice(0, 500));
    throw new SpotifyUnavailableError('No pude consultar Spotify en este momento.');
  }

  return response.json();
}

// --- Normalización ---
// Formato interno común, pensado para encajar directo en musicSessionStore/musicEmbeds
// sin que ningún otro módulo tenga que saber de dónde salió. `url: null` es la señal
// explícita de "todavía no tiene fuente de audio resuelta" — musicEngine.js la resuelve
// recién cuando la canción está por sonar de verdad (nunca acá, nunca por adelantado).
function pickArtists(artists) {
  return (artists || []).map((a) => a.name).join(', ') || 'Desconocido';
}

function pickThumbnail(images) {
  return images?.[0]?.url || null;
}

function isValidEntry(track) {
  return Boolean(track && track.name && !track.is_local && track.type !== 'episode');
}

// Track object completo (GET /tracks/{id}, o el que viene embebido en cada item de una
// playlist) — trae su propio `album` con imágenes y (cuando Spotify lo sigue exponiendo)
// external_ids con el ISRC.
function normalizeFullTrack(track, requestedBy) {
  return {
    title: track.name,
    artist: pickArtists(track.artists),
    album: track.album?.name || null,
    durationSec: typeof track.duration_ms === 'number' ? Math.round(track.duration_ms / 1000) : null,
    thumbnail: pickThumbnail(track.album?.images),
    isrc: track.external_ids?.isrc || null,
    source: 'spotify',
    sourceUrl: track.external_urls?.spotify || null,
    requestedBy,
    addedAt: Date.now(),
    url: null,
  };
}

// SimplifiedTrackObject (GET /albums/{id}/tracks) — nunca trae su propio `album` ni
// external_ids, se completa con la metadata del álbum contenedor.
function normalizeSimplifiedTrack(track, albumMeta, requestedBy) {
  return {
    title: track.name,
    artist: pickArtists(track.artists),
    album: albumMeta?.name || null,
    durationSec: typeof track.duration_ms === 'number' ? Math.round(track.duration_ms / 1000) : null,
    thumbnail: albumMeta?.thumbnail || null,
    isrc: null,
    source: 'spotify',
    sourceUrl: track.external_urls?.spotify || null,
    requestedBy,
    addedAt: Date.now(),
    url: null,
  };
}

// --- Resolución por tipo ---

async function resolveSingleTrack(id, requestedBy) {
  const data = await spotifyFetch(`/tracks/${id}`, { notFoundMessage: 'No pude encontrar información para esa canción.' });
  if (!isValidEntry(data)) throw new SpotifyUnavailableError('Esa canción no está disponible.');
  return { type: 'track', name: data.name, tracks: [normalizeFullTrack(data, requestedBy)], totalCount: 1, skippedCount: 0 };
}

async function resolvePlaylist(id, requestedBy, maxTracks) {
  const meta = await spotifyFetch(`/playlists/${id}?fields=name,public`, {
    notFoundMessage: 'No encontré esa playlist de Spotify.',
    privateMessage: 'No puedo acceder a esa playlist de Spotify.',
  });

  const tracks = [];
  let skipped = 0;
  let total = 0;
  let next = `/playlists/${id}/items?limit=${PAGE_LIMIT}&offset=0`;

  while (next && tracks.length < maxTracks) {
    const page = await spotifyFetch(next);
    if (typeof page.total === 'number') total = page.total;

    for (const item of page.items || []) {
      if (tracks.length >= maxTracks) break;
      const track = item?.item || item?.track; // 'item' es el campo nuevo (2026-02); 'track' queda como fallback del formato viejo
      if (!isValidEntry(track)) {
        skipped++;
        continue;
      }
      tracks.push(normalizeFullTrack(track, requestedBy));
    }

    next = page.next || null;
  }

  return { type: 'playlist', name: meta.name || 'Playlist de Spotify', tracks, totalCount: total, skippedCount: skipped };
}

async function resolveAlbum(id, requestedBy, maxTracks) {
  const meta = await spotifyFetch(`/albums/${id}?fields=name,images`, {
    notFoundMessage: 'No encontré ese álbum de Spotify.',
    privateMessage: 'No puedo acceder a ese álbum de Spotify.',
  });
  const albumMeta = { name: meta.name, thumbnail: pickThumbnail(meta.images) };

  const tracks = [];
  let skipped = 0;
  let total = 0;
  let next = `/albums/${id}/tracks?limit=${PAGE_LIMIT}&offset=0`;

  while (next && tracks.length < maxTracks) {
    const page = await spotifyFetch(next);
    if (typeof page.total === 'number') total = page.total;

    for (const track of page.items || []) {
      if (tracks.length >= maxTracks) break;
      if (!isValidEntry(track)) {
        skipped++;
        continue;
      }
      tracks.push(normalizeSimplifiedTrack(track, albumMeta, requestedBy));
    }

    next = page.next || null;
  }

  return { type: 'album', name: albumMeta.name || 'Álbum de Spotify', tracks, totalCount: total, skippedCount: skipped };
}

// Punto de entrada único. maxTracks acota la paginación al espacio real que queda en la
// cola (musicSessionStore.MAX_QUEUE_SIZE - queue.length) — así una playlist enorme nunca
// dispara más pedidos a la API de los que realmente van a poder encolarse.
export async function resolveSpotifyInput(url, { requestedBy, maxTracks }) {
  const parsed = parseSpotifyUrl(url);
  if (!parsed) throw new SpotifyNotFoundError('Esa no es una URL de Spotify válida.');
  if (maxTracks <= 0) throw new SpotifyUnavailableError('La cola ya está llena.');

  if (parsed.type === 'track') return resolveSingleTrack(parsed.id, requestedBy);
  if (parsed.type === 'playlist') return resolvePlaylist(parsed.id, requestedBy, maxTracks);
  return resolveAlbum(parsed.id, requestedBy, maxTracks);
}

// Solo para tests.
export function _resetTokenCacheForTests() {
  tokenCache = null;
}
