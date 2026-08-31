import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';

// FASE 1 (auditoría de seguridad/economía, 2026-08-30) — dos bugs reales en
// dashboard/server.js, /spotify/callback:
//
// 1) XSS: el parámetro `error` que devuelve Spotify se interpolaba directo en HTML.
// 2) TOCTOU de ownership: /spotify/authorize valida que quien dispara la autorización
//    sea el dueño real de la app de Discord, pero /spotify/callback (que es el que
//    persiste el refresh token en la fila global spotify_auth) nunca revalidaba nada —
//    y comparte la MISMA cookie oauth_state que usa /auth/login (login normal), así que
//    un usuario cualquiera logueado en el dashboard podía fabricar su propio intento de
//    autorización de Spotify sin pasar por /spotify/authorize.
//
// Este test pega peticiones HTTP reales contra la app real de Express (server.js
// exportado, sin levantar el listener de producción — ver el guard de import.meta.url en
// ese archivo) para probar el flujo end-to-end tal cual corre, no una reimplementación.

const dashboardConfigMock = {
  clientSecret: 'test-client-secret',
  sessionSecret: 'test-session-secret',
  baseUrl: 'http://localhost:3000',
  port: 0,
};
vi.mock('../dashboard/config.js', () => ({ dashboardConfig: dashboardConfigMock }));

const configMock = {
  discordToken: 'test-discord-token',
  clientId: 'test-client-id',
  guildIdDev: null,
  supabaseUrl: 'http://localhost:54321',
  supabaseServiceRoleKey: 'test-service-role-key',
  spotifyClientId: 'test-spotify-client-id',
  spotifyClientSecret: 'test-spotify-client-secret',
};
vi.mock('../src/config.js', () => ({ config: configMock }));

vi.mock('../src/supabaseClient.js', () => ({ supabase: {} }));

const fetchApplicationOwnerId = vi.fn();
vi.mock('../dashboard/discordApi.js', () => ({
  buildAuthorizeUrl: vi.fn(() => 'https://discord.com/oauth2/authorize?mock=1'),
  exchangeCodeForToken: vi.fn(),
  fetchDiscordUser: vi.fn(),
  fetchApplicationOwnerId,
  resolveUsers: vi.fn().mockResolvedValue(new Map()),
  fetchGuild: vi.fn(),
  fetchGuildMember: vi.fn(),
  fetchGuildMembersWithRole: vi.fn(),
  mapWithConcurrency: vi.fn(),
}));

const exchangeSpotifyCode = vi.fn();
vi.mock('../dashboard/spotifyAuth.js', () => ({
  buildSpotifyAuthorizeUrl: vi.fn(() => 'https://accounts.spotify.com/authorize?mock=1'),
  exchangeSpotifyCode,
  isSpotifyAuthConfigured: vi.fn(() => true),
}));

const saveSpotifyRefreshToken = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/spotifyAuthStore.js', () => ({
  saveSpotifyRefreshToken,
  getSpotifyRefreshToken: vi.fn().mockResolvedValue(null),
}));

// session.js se deja REAL (no mockeado) — firma/verifica cookies de verdad con el
// sessionSecret mockeado de arriba, así el test ejercita el mismo mecanismo de sesión
// que producción, no una versión simulada.
const { createSessionCookie, createStateCookie } = await import('../dashboard/session.js');
const { app } = await import('../dashboard/server.js');

let server;
let port;

beforeAll(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function cookiePair(setCookieString) {
  return setCookieString.split(';')[0];
}

function requestGet(path, { cookies = [] } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers: cookies.length ? { Cookie: cookies.join('; ') } : {},
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchApplicationOwnerId.mockResolvedValue('owner-1');
  exchangeSpotifyCode.mockResolvedValue({ refresh_token: 'rt-nuevo' });
  saveSpotifyRefreshToken.mockResolvedValue(undefined);
});

describe('GET /spotify/callback — XSS en el parámetro error', () => {
  it('un <script> en ?error= nunca llega sin escapar al HTML de la respuesta', async () => {
    const sessionCookie = cookiePair(createSessionCookie('owner-1'));
    const res = await requestGet(`/spotify/callback?error=${encodeURIComponent('<script>alert(1)</script>')}`, {
      cookies: [sessionCookie],
    });

    expect(res.status).toBe(400);
    expect(res.body).not.toContain('<script>alert(1)</script>');
    expect(res.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('GET /spotify/callback — revalidación del owner', () => {
  it('sin sesión (no autenticado): redirige a /auth/login, no persiste nada', async () => {
    const res = await requestGet('/spotify/callback?code=abc&state=xyz');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/login');
    expect(saveSpotifyRefreshToken).not.toHaveBeenCalled();
    expect(exchangeSpotifyCode).not.toHaveBeenCalled();
  });

  it('usuario NO dueño de la app: se rechaza con 403 y no se persiste ningún refresh token', async () => {
    fetchApplicationOwnerId.mockResolvedValue('owner-1');
    const state = 'state-abc';
    const sessionCookie = cookiePair(createSessionCookie('attacker-1')); // logueado, pero no es el owner
    const stateCookie = cookiePair(createStateCookie(state));

    const res = await requestGet(`/spotify/callback?code=some-code&state=${state}`, {
      cookies: [sessionCookie, stateCookie],
    });

    expect(res.status).toBe(403);
    expect(exchangeSpotifyCode).not.toHaveBeenCalled(); // ni siquiera intercambia el code
    expect(saveSpotifyRefreshToken).not.toHaveBeenCalled();
  });

  it('el dueño real de la app: el flujo se completa y el refresh token se guarda con SU id', async () => {
    fetchApplicationOwnerId.mockResolvedValue('owner-1');
    const state = 'state-abc';
    const sessionCookie = cookiePair(createSessionCookie('owner-1'));
    const stateCookie = cookiePair(createStateCookie(state));

    const res = await requestGet(`/spotify/callback?code=some-code&state=${state}`, {
      cookies: [sessionCookie, stateCookie],
    });

    expect(res.status).toBe(200);
    expect(exchangeSpotifyCode).toHaveBeenCalledWith('some-code');
    expect(saveSpotifyRefreshToken).toHaveBeenCalledWith('rt-nuevo', 'owner-1');
  });
});
