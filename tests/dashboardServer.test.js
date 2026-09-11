import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';

// TEST-3, Fase 4B: dashboard/server.js exporta `app` detrás de un guard específicamente
// para esto (Fase 1, 2026-08-30) pero hasta ahora ningún test lo importaba — el gate
// real de autorización (readSession -> checkGuildAccess -> render) solo se ejercitaba
// mockeado en piezas sueltas (dashboardQueries.test.js), nunca de punta a punta contra
// un server HTTP real. Usa node:http (server real, puerto real) + fetch como cliente —
// el proyecto no tiene supertest, mismo criterio que documenta CLAUDE.md.
//
// dashboard/config.js exige CLIENT_SECRET/DASHBOARD_SESSION_SECRET/DASHBOARD_BASE_URL
// vía variables de entorno reales — se setean ACÁ (antes del import dinámico de
// server.js) en vez de tocar .env del proyecto, que es config real de Fran.
process.env.CLIENT_SECRET = 'test-client-secret';
process.env.DASHBOARD_SESSION_SECRET = 'test-session-secret-suficientemente-largo';
process.env.DASHBOARD_BASE_URL = 'http://localhost:0';

// Se mockea la capa de datos (queries.js) — TEST-3 prueba el GATE de acceso, no las
// queries en sí (ya cubiertas en dashboardQueries.test.js). discordApi.js se mockea
// para no pegarle a Discord real desde un test.
const checkGuildAccess = vi.fn();
const loadGuildDashboardData = vi.fn();
const listManagedGuilds = vi.fn();
vi.mock('../dashboard/queries.js', () => ({ checkGuildAccess, loadGuildDashboardData, listManagedGuilds }));

const resolveUsers = vi.fn().mockResolvedValue(new Map());
const buildAuthorizeUrl = vi.fn((state) => `https://discord.com/oauth2/authorize?state=${state}`);
const exchangeCodeForToken = vi.fn();
const fetchDiscordUser = vi.fn();
vi.mock('../dashboard/discordApi.js', () => ({
  resolveUsers: (...a) => resolveUsers(...a),
  buildAuthorizeUrl: (...a) => buildAuthorizeUrl(...a),
  exchangeCodeForToken: (...a) => exchangeCodeForToken(...a),
  fetchDiscordUser: (...a) => fetchDiscordUser(...a),
}));

const { app } = await import('../dashboard/server.js');
const { createSessionCookie, createStateCookie } = await import('../dashboard/session.js');

let server;
let baseUrl;

beforeAll(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  vi.clearAllMocks();
  resolveUsers.mockResolvedValue(new Map());
});

// Solo el nombre=valor — el resto de los flags del Set-Cookie real (HttpOnly, Max-Age,
// etc.) no aplican a la cabecera Cookie de un request saliente.
function sessionCookieFor(userId) {
  return createSessionCookie(userId).split(';')[0];
}

function stateCookieFor(state) {
  return createStateCookie(state).split(';')[0];
}

function get(path, { cookie } = {}) {
  return fetch(`${baseUrl}${path}`, { headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual' });
}

const REAL_GUILD_ID = '123456789012345678'; // snowflake válido (17-20 dígitos)

describe('GET /guild/:guildId — CASO A: sin sesión', () => {
  it('redirige a /auth/login y NUNCA llega a checkGuildAccess', async () => {
    const res = await get(`/guild/${REAL_GUILD_ID}`);

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/auth/login');
    expect(checkGuildAccess).not.toHaveBeenCalled();
    expect(loadGuildDashboardData).not.toHaveBeenCalled();
  });

  it('una cookie con firma inválida (forjada) se trata igual que sin sesión — no cuela', async () => {
    const real = sessionCookieFor('user-1');
    const forged = real.replace(/\.[^.]+$/, '.firma-inventada');

    const res = await get(`/guild/${REAL_GUILD_ID}`, { cookie: forged });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/auth/login');
    expect(checkGuildAccess).not.toHaveBeenCalled();
  });
});

describe('GET /guild/:guildId — CASO B: sesión válida, SIN acceso a este guild', () => {
  it('devuelve 403 y nunca llega a cargar datos del guild (cross-guild data access bloqueado)', async () => {
    checkGuildAccess.mockResolvedValue(null); // el usuario está logueado pero no es owner/staff de ESTE guild

    const res = await get(`/guild/${REAL_GUILD_ID}`, { cookie: sessionCookieFor('user-sin-acceso') });
    const body = await res.text();

    expect(res.status).toBe(403);
    expect(body).toContain('Sin acceso');
    expect(checkGuildAccess).toHaveBeenCalledWith(REAL_GUILD_ID, 'user-sin-acceso');
    expect(loadGuildDashboardData).not.toHaveBeenCalled();
  });
});

describe('GET /guild/:guildId — CASO C: sesión válida, CON acceso', () => {
  it('devuelve 200 y renderiza los datos reales del guild', async () => {
    checkGuildAccess.mockResolvedValue({ guild: { id: REAL_GUILD_ID, name: 'Servidor de Prueba', approximate_member_count: 42 } });
    loadGuildDashboardData.mockResolvedValue({
      topCommands: [], totalCommands: 0, unlockedAchievementIds: new Set(), topBalances: [], totalCoins: 0,
      recentWarns: [], totalWarns: 0, activeGiveaways: [], topTrivia: [], punishedMembers: [], punishedTotal: 0,
      punishedPossiblyIncomplete: false, topXp: [], xpUserCount: 0,
      voiceStats: { totalSessions: 0, totalDurationSeconds: 0, peakConcurrent: 0, topOwners: [] },
      topAchievers: [], lolChannelId: null, lolLastUrl: null, lolLastAnnouncedAt: null, dailyStats: [],
      messagesDelta: null, missionSummary: { dailyCompletedUsers: 0, weeklyCompletedUsers: 0 }, guildConfig: {},
    });

    const res = await get(`/guild/${REAL_GUILD_ID}`, { cookie: sessionCookieFor('user-con-acceso') });
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain('Servidor de Prueba');
    expect(checkGuildAccess).toHaveBeenCalledWith(REAL_GUILD_ID, 'user-con-acceso');
    expect(loadGuildDashboardData).toHaveBeenCalledWith(REAL_GUILD_ID);
  });
});

// Regresión (2026-09-05): fetchGuildConfigSummary (dashboard/queries.js) empezó a pedir
// una columna (report_channel_id) que en ese momento todavía no existía en la base real
// — Supabase respondía 42703 "column ... does not exist", loadGuildDashboardData lo
// propagaba, y el usuario veía "No se pudo cargar la información de este servidor.".
// Ninguno de los tests de dashboardQueries.test.js lo detectó porque esos mockean
// supabase-js entero (nunca validan contra un schema real) — este test no reproduce ESE
// bug puntual (loadGuildDashboardData está mockeado acá, como el resto del archivo), pero
// sí fija el contrato real: CUALQUIER falla de loadGuildDashboardData (columna
// inexistente, tabla caída, lo que sea) tiene que dar un 500 controlado, con un mensaje
// genérico — nunca un stack trace ni un mensaje de Postgres crudo expuesto al usuario.
describe('GET /guild/:guildId — CASO D: falla la carga de datos (ej. columna/tabla inexistente en Supabase)', () => {
  it('devuelve 500 genérico, sin exponer el error interno de Postgres/Supabase', async () => {
    checkGuildAccess.mockResolvedValue({ guild: { id: REAL_GUILD_ID, name: 'Servidor de Prueba', approximate_member_count: 42 } });
    loadGuildDashboardData.mockRejectedValue(
      Object.assign(new Error('column guild_config.report_channel_id does not exist'), { code: '42703' }),
    );

    const res = await get(`/guild/${REAL_GUILD_ID}`, { cookie: sessionCookieFor('user-con-acceso') });
    const body = await res.text();

    expect(res.status).toBe(500);
    expect(body).toContain('No se pudo cargar la información de este servidor');
    expect(body).not.toContain('42703');
    expect(body).not.toContain('does not exist');
  });
});

describe('GET /guild/:guildId — guildId con formato inválido', () => {
  it('un guildId que no es un snowflake válido se rechaza con 400 ANTES de tocar checkGuildAccess', async () => {
    const res = await get('/guild/0%2F..%2F..%2Fusers%2F@me', { cookie: sessionCookieFor('user-1') });

    expect(res.status).toBe(400);
    expect(checkGuildAccess).not.toHaveBeenCalled();
  });
});

describe('GET / — mismo gate de sesión', () => {
  it('sin sesión: muestra la página de login, nunca llama a listManagedGuilds', async () => {
    const res = await get('/');
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain('Iniciar sesión con Discord');
    expect(listManagedGuilds).not.toHaveBeenCalled();
  });

  it('con sesión válida: lista los servidores reales del usuario', async () => {
    listManagedGuilds.mockResolvedValue([{ id: REAL_GUILD_ID, name: 'Mi Server', icon: null }]);

    const res = await get('/', { cookie: sessionCookieFor('user-1') });
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain('Mi Server');
    expect(listManagedGuilds).toHaveBeenCalledWith('user-1');
  });
});

// Auditoría completa NEXO (2026-09-11), DASH-1: ninguna respuesta llevaba headers de
// hardening — una página autenticada podía quedar en el caché del navegador (compu
// compartida, botón "Atrás" después de logout), y ninguna ruta bloqueaba ser embebida
// en un <iframe> de un sitio de terceros.
describe('Headers de seguridad — DASH-1', () => {
  it('toda respuesta lleva Cache-Control: no-store y X-Frame-Options: DENY', async () => {
    const res = await get('/');

    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('también se aplican a una página autenticada (/guild/:guildId)', async () => {
    checkGuildAccess.mockResolvedValue({ guild: { id: REAL_GUILD_ID, name: 'Mi Server' } });
    loadGuildDashboardData.mockResolvedValue({
      topCommands: [], totalCommands: 0, unlockedAchievementIds: new Set(), topBalances: [], totalCoins: 0,
      recentWarns: [], totalWarns: 0, activeGiveaways: [], topTrivia: [], punishedMembers: [], punishedTotal: 0,
      punishedPossiblyIncomplete: false, topXp: [], xpUserCount: 0,
      voiceStats: { totalSessions: 0, totalDurationSeconds: 0, peakConcurrent: 0, topOwners: [] },
      topAchievers: [], lolChannelId: null, lolLastUrl: null, lolLastAnnouncedAt: null, dailyStats: [],
      messagesDelta: null, missionSummary: { dailyCompletedUsers: 0, weeklyCompletedUsers: 0 }, guildConfig: {},
    });

    const res = await get(`/guild/${REAL_GUILD_ID}`, { cookie: sessionCookieFor('user-1') });

    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });
});

// Auditoría completa NEXO (2026-09-11): el flujo de login OAuth nunca se ejercitó de
// punta a punta — ni /auth/login ni /auth/callback tenían un test, pese a ser la zona
// donde ya hubo un bug de seguridad real (Fase 1: /spotify/callback compartía la MISMA
// cookie de state que /auth/login, permitiendo un TOCTOU sobre el owner de Spotify; ese
// endpoint ya no existe, pero el mecanismo de state que sigue vivo acá nunca quedó
// cubierto). exchangeCodeForToken/fetchDiscordUser están mockeados (discordApi.js) —
// esto prueba el GATE del callback (validación de state, creación de sesión, manejo de
// errores), no la lógica interna de esas dos funciones (cubierta aparte en
// dashboardDiscordApi.test.js).
describe('GET /auth/login', () => {
  it('genera un state aleatorio, lo guarda en cookie, y redirige a la URL de autorización real', async () => {
    const res = await get('/auth/login');

    expect(res.status).toBe(302);
    expect(buildAuthorizeUrl).toHaveBeenCalledTimes(1);
    const [stateUsed] = buildAuthorizeUrl.mock.calls[0];
    expect(res.headers.get('location')).toContain(stateUsed);

    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('oauth_state='));
    expect(setCookie).toContain(`oauth_state=${stateUsed}`);
  });

  it('dos logins seguidos generan states DISTINTOS (no reusa el mismo valor)', async () => {
    await get('/auth/login');
    const first = buildAuthorizeUrl.mock.calls[0][0];
    await get('/auth/login');
    const second = buildAuthorizeUrl.mock.calls[1][0];

    expect(first).not.toBe(second);
  });
});

describe('GET /auth/callback', () => {
  it('sin code ni state: 400, nunca llega a intercambiar nada con Discord', async () => {
    const res = await get('/auth/callback');

    expect(res.status).toBe(400);
    expect(exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('state del query NO coincide con la cookie (CSRF): 400, nunca intercambia el code', async () => {
    const res = await get('/auth/callback?code=abc&state=state-falso', { cookie: stateCookieFor('state-real') });

    expect(res.status).toBe(400);
    expect(exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('sin cookie de state (llegó directo, nunca pasó por /auth/login): 400', async () => {
    const res = await get('/auth/callback?code=abc&state=cualquiera');

    expect(res.status).toBe(400);
    expect(exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('caso exitoso: state coincide, intercambia el code, crea la sesión y redirige a "/"', async () => {
    exchangeCodeForToken.mockResolvedValue({ access_token: 'tok-123' });
    fetchDiscordUser.mockResolvedValue({ id: 'user-42', username: 'facu' });

    const res = await get('/auth/callback?code=code-real&state=state-valido', { cookie: stateCookieFor('state-valido') });

    expect(exchangeCodeForToken).toHaveBeenCalledWith('code-real');
    expect(fetchDiscordUser).toHaveBeenCalledWith('tok-123');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');

    const cookies = res.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith('nexo_dashboard_session='))).toBe(true);
    expect(cookies.some((c) => c.startsWith('oauth_state=;'))).toBe(true); // se limpia la cookie de state usada
  });

  it('la sesión creada identifica al usuario correcto (no un ID inventado ni el de otro test)', async () => {
    exchangeCodeForToken.mockResolvedValue({ access_token: 'tok-456' });
    fetchDiscordUser.mockResolvedValue({ id: 'user-99', username: 'otro' });

    const res = await get('/auth/callback?code=code-2&state=state-2', { cookie: stateCookieFor('state-2') });
    const sessionCookie = res.headers.getSetCookie().find((c) => c.startsWith('nexo_dashboard_session='));

    // Reutiliza esa cookie real contra una ruta protegida y confirma que resuelve al
    // usuario correcto — más fuerte que inspeccionar el payload firmado a mano.
    checkGuildAccess.mockResolvedValue(null);
    const protectedRes = await get(`/guild/${REAL_GUILD_ID}`, { cookie: sessionCookie.split(';')[0] });
    expect(checkGuildAccess).toHaveBeenCalledWith(REAL_GUILD_ID, 'user-99');
    expect(protectedRes.status).toBe(403); // llegó autenticado (si no, sería 302 a /auth/login)
  });

  it('Discord rechaza el intercambio del code (ej. code ya usado o vencido): 500 genérico, nunca expone el error crudo', async () => {
    exchangeCodeForToken.mockRejectedValue(new Error('Discord OAuth token exchange falló: 400'));

    const res = await get('/auth/callback?code=code-vencido&state=state-3', { cookie: stateCookieFor('state-3') });
    const body = await res.text();

    expect(res.status).toBe(500);
    expect(body).not.toContain('Discord OAuth token exchange falló');
    expect(fetchDiscordUser).not.toHaveBeenCalled();
  });

  it('fetchDiscordUser falla después de un intercambio exitoso: 500 genérico, no crea sesión', async () => {
    exchangeCodeForToken.mockResolvedValue({ access_token: 'tok-789' });
    fetchDiscordUser.mockRejectedValue(new Error('No se pudo obtener el usuario de Discord: 401'));

    const res = await get('/auth/callback?code=code-4&state=state-4', { cookie: stateCookieFor('state-4') });

    expect(res.status).toBe(500);
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith('nexo_dashboard_session='))).toBe(false);
  });
});
