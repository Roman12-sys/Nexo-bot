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
vi.mock('../dashboard/discordApi.js', () => ({
  resolveUsers,
  buildAuthorizeUrl: vi.fn(),
  exchangeCodeForToken: vi.fn(),
  fetchDiscordUser: vi.fn(),
}));

const { app } = await import('../dashboard/server.js');
const { createSessionCookie } = await import('../dashboard/session.js');

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
