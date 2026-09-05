import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createSupabaseMock } from './helpers/supabaseMock.js';

// dashboard/queries.js — Fase 2C, secciones 1/2/3/4. Foco SOLO en lo que cambió: cache
// de metadata de guild en listManagedGuilds (sección 1), tope de punishedMembers con
// total real (sección 2), agregaciones movidas a RPC (sección 3), y concurrencia
// acotada en loadGuildDashboardData (sección 4). No se re-testea todo lo que ya existía
// sin cambios.
const supabaseMock = createSupabaseMock();
vi.mock('../src/supabaseClient.js', () => ({ get supabase() { return supabaseMock; } }));

const getTopCommands = vi.fn().mockResolvedValue([]);
const getTotalUsage = vi.fn().mockResolvedValue(0);
vi.mock('../src/utils/commandUsageStore.js', () => ({ getTopCommands, getTotalUsage }));

const getUnlockedGuildAchievementIds = vi.fn().mockResolvedValue(new Set());
vi.mock('../src/utils/guildAchievements.js', () => ({ getUnlockedGuildAchievementIds }));

const getGuildGiveawaysForAutocomplete = vi.fn().mockResolvedValue([]);
vi.mock('../src/utils/giveawaysStore.js', () => ({ getGuildGiveawaysForAutocomplete }));

const getGuildTrivia = vi.fn().mockResolvedValue([]);
vi.mock('../src/utils/triviaStore.js', () => ({ getGuildTrivia }));

const getGuildXp = vi.fn().mockResolvedValue([]);
vi.mock('../src/utils/xpStore.js', () => ({ getGuildXp }));

const getGuildVoiceStatsSummary = vi.fn().mockResolvedValue({ totalSessions: 0, totalDurationSeconds: 0, peakConcurrent: 0, topOwners: [] });
vi.mock('../src/utils/tempVoiceStore.js', () => ({ getGuildVoiceStatsSummary }));

const getGuildMissionCompletionSummary = vi.fn().mockResolvedValue({ dailyCompletedUsers: 0, weeklyCompletedUsers: 0 });
vi.mock('../src/utils/missionsStore.js', () => ({ getGuildMissionCompletionSummary }));

const getGuildDailyStats = vi.fn().mockResolvedValue([]);
vi.mock('../src/utils/guildDailyStatsStore.js', () => ({ getGuildDailyStats }));

const getLastAnnouncedPatchUrl = vi.fn().mockResolvedValue(null);
const getLolPatchMonitorState = vi.fn().mockResolvedValue({ patchEngineUpdatedAt: null });
vi.mock('../src/utils/lolPatchStore.js', () => ({ getLastAnnouncedPatchUrl, getLolPatchMonitorState }));

const fetchGuild = vi.fn();
const fetchGuildMember = vi.fn();
const fetchGuildMembersWithRole = vi.fn().mockResolvedValue({ members: [], possiblyIncomplete: false });
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
vi.mock('../dashboard/discordApi.js', () => ({ fetchGuild, fetchGuildMember, fetchGuildMembersWithRole, mapWithConcurrency }));

const isStaffFromRoles = vi.fn().mockReturnValue(false);
vi.mock('../dashboard/permissions.js', () => ({ isStaffFromRoles }));

const { listManagedGuilds, loadGuildDashboardData } = await import('../dashboard/queries.js');

beforeEach(() => {
  vi.clearAllMocks();
  supabaseMock.rpc.mockReset();
  fetchGuildMembersWithRole.mockResolvedValue({ members: [], possiblyIncomplete: false });
});

describe('listManagedGuilds — cache de metadata de guild (sección 1)', () => {
  it('dos cargas seguidas del mismo guild: fetchGuild se llama UNA sola vez (cache hit en la segunda)', async () => {
    supabaseMock.getBuilder('guild_config').__setResult({ data: [{ guild_id: 'guild-cache-1', admin_role_id: null, moderator_role_id: null }], error: null });
    fetchGuild.mockResolvedValue({ id: 'guild-cache-1', name: 'Cacheable', icon: null, owner_id: 'owner-1' });

    await listManagedGuilds('owner-1');
    await listManagedGuilds('owner-1');

    expect(fetchGuild).toHaveBeenCalledTimes(1);
  });

  it('el chequeo de ROL de staff nunca se cachea: se pide fresco en cada carga', async () => {
    supabaseMock.getBuilder('guild_config').__setResult({
      data: [{ guild_id: 'guild-cache-2', admin_role_id: 'role-admin', moderator_role_id: null }],
      error: null,
    });
    fetchGuild.mockResolvedValue({ id: 'guild-cache-2', name: 'Con rol', icon: null, owner_id: 'someone-else' });
    fetchGuildMember.mockResolvedValue({ roles: ['role-admin'] });
    isStaffFromRoles.mockReturnValue(true);

    await listManagedGuilds('staff-user');
    await listManagedGuilds('staff-user');

    expect(fetchGuild).toHaveBeenCalledTimes(1); // metadata cacheada
    expect(fetchGuildMember).toHaveBeenCalledTimes(2); // pertenencia SIEMPRE en vivo
  });

  it('un guild que el bot ya no tiene (fetchGuild devuelve null) no queda cacheado como inválido para siempre', async () => {
    supabaseMock.getBuilder('guild_config').__setResult({ data: [{ guild_id: 'guild-gone', admin_role_id: null, moderator_role_id: null }], error: null });
    fetchGuild.mockResolvedValueOnce(null);

    const first = await listManagedGuilds('owner-1');
    expect(first).toEqual([]);

    fetchGuild.mockResolvedValueOnce({ id: 'guild-gone', name: 'Volvió', icon: null, owner_id: 'owner-1' });
    const second = await listManagedGuilds('owner-1');

    expect(second).toEqual([{ id: 'guild-gone', name: 'Volvió', icon: null }]);
    expect(fetchGuild).toHaveBeenCalledTimes(2); // el null no se cacheó, se volvió a pedir
  });
});

function mockLoadGuildDashboardDeps() {
  supabaseMock.getBuilder('guild_config').__setResult({ data: { punish_role_id: 'role-sancionado' }, error: null });
  supabaseMock.getBuilder('economy').__setResult({ data: [], error: null });
  supabaseMock.getBuilder('warnings').__setResult({ data: [], error: null, count: 0 });
  supabaseMock.getBuilder('xp').__setResult({ data: [], error: null, count: 0 });
  supabaseMock.rpc.mockImplementation(async (fnName) => {
    if (fnName === 'sum_guild_balances') return { data: 12345, error: null };
    if (fnName === 'top_guild_achievers') return { data: [{ user_id: 'user-1', unlock_count: 3 }], error: null };
    return { data: null, error: null };
  });
}

describe('loadGuildDashboardData — punishedMembers acotado (sección 2)', () => {
  it('con más de 20 sancionados, devuelve como mucho 20 pero el total real completo', async () => {
    mockLoadGuildDashboardDeps();
    const manyMembers = Array.from({ length: 47 }, (_, i) => ({ user: { id: `user-${i}` } }));
    fetchGuildMembersWithRole.mockResolvedValue({ members: manyMembers, possiblyIncomplete: false });

    const data = await loadGuildDashboardData('guild-1');

    expect(data.punishedMembers.length).toBe(20);
    expect(data.punishedTotal).toBe(47);
  });

  it('con pocos sancionados, no hay recorte (members.length === total)', async () => {
    mockLoadGuildDashboardDeps();
    const fewMembers = [{ user: { id: 'user-1' } }, { user: { id: 'user-2' } }];
    fetchGuildMembersWithRole.mockResolvedValue({ members: fewMembers, possiblyIncomplete: false });

    const data = await loadGuildDashboardData('guild-1');

    expect(data.punishedMembers).toEqual(['user-1', 'user-2']);
    expect(data.punishedTotal).toBe(2);
  });
});

describe('loadGuildDashboardData — configuración actual (DASH-1, Fase 4B)', () => {
  it('devuelve guildConfig con los campos reales de guild_config (roles, logs, features)', async () => {
    mockLoadGuildDashboardDeps();
    supabaseMock.getBuilder('guild_config').__setResult({
      data: {
        admin_role_id: 'role-admin-1',
        moderator_role_id: 'role-mod-1',
        log_channel_moderation_id: 'chan-mod-1',
        log_channel_activity_id: 'chan-act-1',
        log_channel_economy_id: 'chan-eco-1',
        features: { moderacion: true, xp: true },
        punish_role_id: 'role-sancionado',
        auto_role_id: null,
        welcome_channel_id: null,
        confession_channel_id: null,
      },
      error: null,
    });

    const data = await loadGuildDashboardData('guild-1');

    expect(data.guildConfig).toEqual({
      admin_role_id: 'role-admin-1',
      moderator_role_id: 'role-mod-1',
      log_channel_moderation_id: 'chan-mod-1',
      log_channel_activity_id: 'chan-act-1',
      log_channel_economy_id: 'chan-eco-1',
      features: { moderacion: true, xp: true },
      punish_role_id: 'role-sancionado',
      auto_role_id: null,
      welcome_channel_id: null,
      confession_channel_id: null,
    });
  });

  it('un servidor sin fila en guild_config (recién agregado): guildConfig es un objeto vacío, no rechaza', async () => {
    mockLoadGuildDashboardDeps();
    supabaseMock.getBuilder('guild_config').__setResult({ data: null, error: null });

    const data = await loadGuildDashboardData('guild-1');

    expect(data.guildConfig).toEqual({});
  });
});

describe('loadGuildDashboardData — agregaciones en Postgres, no en JS (sección 3)', () => {
  it('totalCoins viene de la RPC sum_guild_balances, no de sumar filas en JS', async () => {
    mockLoadGuildDashboardDeps();

    const data = await loadGuildDashboardData('guild-1');

    expect(supabaseMock.rpc).toHaveBeenCalledWith('sum_guild_balances', { p_guild_id: 'guild-1' });
    expect(data.totalCoins).toBe(12345);
  });

  it('topAchievers viene de la RPC top_guild_achievers con limit 5', async () => {
    mockLoadGuildDashboardDeps();

    const data = await loadGuildDashboardData('guild-1');

    expect(supabaseMock.rpc).toHaveBeenCalledWith('top_guild_achievers', { p_guild_id: 'guild-1', p_limit: 5 });
    expect(data.topAchievers).toEqual([{ userId: 'user-1', count: 3 }]);
  });
});

describe('loadGuildDashboardData — concurrencia acotada (sección 4)', () => {
  it('nunca hay más de 6 fuentes de datos en vuelo al mismo tiempo', async () => {
    mockLoadGuildDashboardDeps();

    let inFlight = 0;
    let maxInFlight = 0;
    // Instrumentamos las 11 fuentes fáciles de demorar artificialmente (las otras son
    // funciones de este mismo archivo, no mocks — incluida fetchGuildConfigSummary,
    // sumada en DASH-1/Fase 4B) para forzar solapamiento real y medirlo, en vez de solo
    // confiar en que Promise.all lo haría de cualquier forma.
    getTopCommands.mockImplementation(async () => { inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight -= 1; return []; });
    getTotalUsage.mockImplementation(async () => { inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight -= 1; return 0; });
    getUnlockedGuildAchievementIds.mockImplementation(async () => { inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight -= 1; return new Set(); });
    getGuildGiveawaysForAutocomplete.mockImplementation(async () => { inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight -= 1; return []; });
    getGuildTrivia.mockImplementation(async () => { inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight -= 1; return []; });
    getGuildXp.mockImplementation(async () => { inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight -= 1; return []; });
    getGuildVoiceStatsSummary.mockImplementation(async () => { inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight -= 1; return { totalSessions: 0, totalDurationSeconds: 0, peakConcurrent: 0, topOwners: [] }; });
    getGuildMissionCompletionSummary.mockImplementation(async () => { inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight -= 1; return { dailyCompletedUsers: 0, weeklyCompletedUsers: 0 }; });
    getGuildDailyStats.mockImplementation(async () => { inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight -= 1; return []; });
    getLastAnnouncedPatchUrl.mockImplementation(async () => { inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight -= 1; return null; });
    getLolPatchMonitorState.mockImplementation(async () => { inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight -= 1; return { patchEngineUpdatedAt: null }; });

    await loadGuildDashboardData('guild-1');

    expect(maxInFlight).toBeLessThanOrEqual(6);
    expect(maxInFlight).toBeGreaterThan(1); // confirma que de verdad corrieron en paralelo, no todo secuencial
  });
});
