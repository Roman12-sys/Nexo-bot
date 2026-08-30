// Mismo rol que discordApi.js cumple para el login de Discord, pero para la
// autorización (única, a nivel bot) de Spotify — Authorization Code Flow, la única forma
// de que /play pueda listar el contenido de una playlist (Client Credentials Flow, que
// usa src/utils/spotifyResolver.js por defecto, alcanza para tracks sueltos pero no para
// eso — confirmado en producción 2026-08-30).
import { config } from '../src/config.js';
import { dashboardConfig } from './config.js';

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const REDIRECT_URI = `${dashboardConfig.baseUrl}/spotify/callback`;

// playlist-read-private/-collaborative: alcanza para que el dueño pueda pasar playlists
// públicas (no hace falta scope) Y las suyas propias, privadas o colaborativas. No se
// piden más scopes de los necesarios (nada de leer la librería completa, seguir
// artistas, etc. — /play solo necesita leer el contenido puntual que alguien pega).
const SCOPES = 'playlist-read-private playlist-read-collaborative';

export function isSpotifyAuthConfigured() {
  return Boolean(config.spotifyClientId && config.spotifyClientSecret);
}

export function buildSpotifyAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: config.spotifyClientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
  });
  return `${AUTHORIZE_URL}?${params}`;
}

export async function exchangeSpotifyCode(code) {
  const basic = Buffer.from(`${config.spotifyClientId}:${config.spotifyClientSecret}`).toString('base64');
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Spotify OAuth token exchange falló: ${res.status}`);
  return res.json();
}
