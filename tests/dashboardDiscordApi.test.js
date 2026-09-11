import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Auditoría completa NEXO (2026-09-11): exchangeCodeForToken/fetchDiscordUser/
// buildAuthorizeUrl no tenían NINGÚN test — ni unitario ni end-to-end — pese a ser la
// zona donde ya hubo un bug real de seguridad (SEC de Fase 1: /spotify/callback
// compartía la misma cookie de state que /auth/login, permitiendo un TOCTOU sobre el
// owner de Spotify). Ese endpoint ya no existe (Fase 3C), pero el mecanismo de
// state/callback que sigue vivo en /auth/callback nunca quedó con una red de
// regresión propia.
process.env.CLIENT_SECRET = 'test-client-secret';
process.env.DASHBOARD_SESSION_SECRET = 'test-session-secret-suficientemente-largo';
process.env.DASHBOARD_BASE_URL = 'http://localhost:0';

const { buildAuthorizeUrl, exchangeCodeForToken, fetchDiscordUser } = await import('../dashboard/discordApi.js');
const { config } = await import('../src/config.js');

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildAuthorizeUrl', () => {
  it('arma la URL de autorización con scope "identify" únicamente — nunca "guilds"', () => {
    const url = buildAuthorizeUrl('el-state-random');
    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(parsed.searchParams.get('scope')).toBe('identify');
    expect(parsed.searchParams.get('client_id')).toBe(config.clientId);
    expect(parsed.searchParams.get('state')).toBe('el-state-random');
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://localhost:0/auth/callback');
  });

  it('nunca pide más scope del necesario, aunque cambie el state', () => {
    const url = buildAuthorizeUrl('otro-state');
    expect(new URL(url).searchParams.get('scope')).not.toContain('guilds');
  });
});

describe('exchangeCodeForToken', () => {
  it('intercambia el código por un token, mandando el client_secret y el redirect_uri correcto', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: 'tok-123', token_type: 'Bearer' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await exchangeCodeForToken('code-abc');

    expect(result).toEqual({ access_token: 'tok-123', token_type: 'Bearer' });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://discord.com/api/v10/oauth2/token');
    expect(options.method).toBe('POST');
    const body = new URLSearchParams(options.body);
    expect(body.get('code')).toBe('code-abc');
    expect(body.get('client_secret')).toBe('test-client-secret');
    expect(body.get('redirect_uri')).toBe('http://localhost:0/auth/callback');
    expect(body.get('grant_type')).toBe('authorization_code');
  });

  it('Discord rechaza el código (400/401): tira un error claro, sin exponer el body crudo de Discord', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));

    await expect(exchangeCodeForToken('code-invalido')).rejects.toThrow('400');
  });
});

describe('fetchDiscordUser', () => {
  it('pide /users/@me con el Bearer token del usuario (no el token del bot)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'user-1', username: 'facu' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = await fetchDiscordUser('access-token-del-usuario');

    expect(user).toEqual({ id: 'user-1', username: 'facu' });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://discord.com/api/v10/users/@me');
    expect(options.headers.Authorization).toBe('Bearer access-token-del-usuario');
  });

  it('token inválido/expirado: tira un error claro en vez de devolver undefined en silencio', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));

    await expect(fetchDiscordUser('token-vencido')).rejects.toThrow('401');
  });
});
