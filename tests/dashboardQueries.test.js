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
// Dashboard 2.0 (MEJORA 1/2) — fetchGuildChannels/fetchGuildRoles alimentan
// computeConfigIssues (¿el canal/rol guardado sigue existiendo?). Sin mock explícito
// por test, resuelven `undefined` — fetchGuildResourceIds lo trata como "no se pudo
// verificar" (null en vez de Set vacío), así que los tests existentes (que no les
// interesa configIssues) no ven ningún falso positivo de "canal borrado".
const fetchGuildChannels = vi.fn().mockResolvedValue(undefined);
const fetchGuildRoles = vi.fn().mockResolvedValue(undefined);
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
vi.mock('../dashboard/discordApi.js', () => ({
  fetchGuild,
  fetchGuildMember,
  fetchGuildMembersWithRole,
  fetchGuildChannels,
  fetchGuildRoles,
  mapWithConcurrency,
}));

const isStaffFromRoles = vi.fn().mockReturnValue(false);
vi.mock('../dashboard/permissions.js', () => ({ isStaffFromRoles }));

const { listManagedGuilds, loadGuildDashboardData, computeSystemsStatus, computeConfigIssues } = await import('../dashboard/queries.js');

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

// ---------------------------------------------------------------------------
// Dashboard 2.0 (MEJORA 1/2, CICLO 1) — computeSystemsStatus/computeConfigIssues son
// funciones puras (sin red, sin Supabase): se testean directo con fixtures, sin pasar
// por todo loadGuildDashboardData.
// ---------------------------------------------------------------------------

describe('computeSystemsStatus', () => {
  it('Economía siempre está "ok" — no tiene toggle real', () => {
    const [economia] = computeSystemsStatus({}, null);
    expect(economia).toEqual({ key: 'economia', label: 'Economía', status: 'ok', detail: 'Siempre activa' });
  });

  it('XP: "ok" si features.xp está activado, "off" si no (nunca un problema)', () => {
    const on = computeSystemsStatus({ features: { xp: true } }, null).find((s) => s.key === 'xp');
    const off = computeSystemsStatus({ features: {} }, null).find((s) => s.key === 'xp');

    expect(on).toEqual({ key: 'xp', label: 'XP', status: 'ok', detail: 'Activo' });
    expect(off).toEqual({ key: 'xp', label: 'XP', status: 'off', detail: 'Apagado' });
  });

  it('Moderación: "off" apagada, "warning" activada sin canal de logs, "ok" activada con canal', () => {
    const off = computeSystemsStatus({ features: {} }, null).find((s) => s.key === 'moderacion');
    const warning = computeSystemsStatus({ features: { moderacion: true } }, null).find((s) => s.key === 'moderacion');
    const ok = computeSystemsStatus({ features: { moderacion: true }, log_channel_moderation_id: 'chan-1' }, null).find((s) => s.key === 'moderacion');

    expect(off.status).toBe('off');
    expect(warning.status).toBe('warning');
    expect(ok.status).toBe('ok');
  });

  it('Sorteos y Trivia siempre están disponibles', () => {
    const statuses = computeSystemsStatus({}, null);
    expect(statuses.find((s) => s.key === 'giveaways')).toMatchObject({ status: 'ok' });
    expect(statuses.find((s) => s.key === 'trivia')).toMatchObject({ status: 'ok' });
  });

  it('Salas de voz temporales: "warning" nunca configurado, "off" desactivado a propósito, "ok" activo', () => {
    const neverConfigured = computeSystemsStatus({}, null).find((s) => s.key === 'tempvoice');
    const disabled = computeSystemsStatus({}, { enabled: false }).find((s) => s.key === 'tempvoice');
    const enabled = computeSystemsStatus({}, { enabled: true }).find((s) => s.key === 'tempvoice');

    expect(neverConfigured).toEqual({ key: 'tempvoice', label: 'Salas de voz temporales', status: 'warning', detail: 'Configuración pendiente' });
    expect(disabled).toEqual({ key: 'tempvoice', label: 'Salas de voz temporales', status: 'off', detail: 'Desactivado' });
    expect(enabled).toEqual({ key: 'tempvoice', label: 'Salas de voz temporales', status: 'ok', detail: 'Activo' });
  });
});

describe('computeConfigIssues', () => {
  it('sin ningún rol de staff configurado: un solo issue "Configuración inicial", nada más', () => {
    const issues = computeConfigIssues({}, { channelIds: new Set(), roleIds: new Set() }, { enabled: true, createChannelId: 'x', categoryId: 'y' });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'danger', title: 'Configuración inicial' });
  });

  it('rol de moderador configurado pero borrado: issue "danger"', () => {
    const cfg = { moderator_role_id: 'role-mod', admin_role_id: 'role-mod' };
    const issues = computeConfigIssues(cfg, { channelIds: new Set(), roleIds: new Set() }, null);

    expect(issues).toContainEqual(expect.objectContaining({ severity: 'danger', title: 'Rol de moderador' }));
  });

  it('rol de administrador distinto del de moderador, borrado: issue propio (no se confunde con el de moderador)', () => {
    const cfg = { moderator_role_id: 'role-mod', admin_role_id: 'role-admin' };
    const issues = computeConfigIssues(cfg, { channelIds: new Set(), roleIds: new Set(['role-mod']) }, null);

    expect(issues).toContainEqual(expect.objectContaining({ title: 'Rol de administrador' }));
    expect(issues.find((i) => i.title === 'Rol de moderador')).toBeUndefined();
  });

  it('admin_role_id igual a moderator_role_id (caso normal, /setup por defecto): no duplica el issue', () => {
    const cfg = { moderator_role_id: 'role-mismo', admin_role_id: 'role-mismo', log_channel_moderation_id: 'chan-mod' };
    const issues = computeConfigIssues(cfg, { channelIds: new Set(['chan-mod']), roleIds: new Set(['role-mismo']) }, null);

    expect(issues).toHaveLength(0);
  });

  it('moderación activada sin canal de logs: warning', () => {
    const cfg = { moderator_role_id: 'role-mod', features: { moderacion: true } };
    const issues = computeConfigIssues(cfg, { channelIds: new Set(), roleIds: new Set(['role-mod']) }, null);

    expect(issues).toContainEqual(expect.objectContaining({ severity: 'warning', title: 'Moderación' }));
  });

  it('canal de logs de moderación configurado pero borrado: danger', () => {
    const cfg = { moderator_role_id: 'role-mod', features: { moderacion: true }, log_channel_moderation_id: 'chan-borrado' };
    const issues = computeConfigIssues(cfg, { channelIds: new Set(), roleIds: new Set(['role-mod']) }, null);

    expect(issues).toContainEqual(expect.objectContaining({ severity: 'danger', title: 'Moderación' }));
  });

  it('reportes: canal dedicado borrado pero el de moderación sigue vivo → warning (cae al fallback)', () => {
    const cfg = { moderator_role_id: 'role-mod', log_channel_moderation_id: 'chan-mod', report_channel_id: 'chan-reportes-borrado' };
    const issues = computeConfigIssues(cfg, { channelIds: new Set(['chan-mod']), roleIds: new Set(['role-mod']) }, null);

    expect(issues).toContainEqual(expect.objectContaining({ severity: 'warning', title: 'Reportes' }));
  });

  it('reportes: canal dedicado borrado Y el de moderación también → danger (no tiene dónde entregar nada)', () => {
    const cfg = { moderator_role_id: 'role-mod', log_channel_moderation_id: 'chan-mod-borrado', report_channel_id: 'chan-reportes-borrado' };
    const issues = computeConfigIssues(cfg, { channelIds: new Set(), roleIds: new Set(['role-mod']) }, null);

    expect(issues).toContainEqual(expect.objectContaining({ severity: 'danger', title: 'Reportes' }));
  });

  it('reportes: sin canal dedicado pero con log de moderación vivo → sin issue (estado normal por defecto)', () => {
    const cfg = { moderator_role_id: 'role-mod', log_channel_moderation_id: 'chan-mod' };
    const issues = computeConfigIssues(cfg, { channelIds: new Set(['chan-mod']), roleIds: new Set(['role-mod']) }, null);

    expect(issues.find((i) => i.title === 'Reportes')).toBeUndefined();
  });

  it('reportes: sin canal dedicado y sin log de moderación → warning', () => {
    const cfg = { moderator_role_id: 'role-mod' };
    const issues = computeConfigIssues(cfg, { channelIds: new Set(), roleIds: new Set(['role-mod']) }, null);

    expect(issues).toContainEqual(expect.objectContaining({ severity: 'warning', title: 'Reportes' }));
  });

  it('rol automático y rol de castigo borrados: warnings independientes', () => {
    const cfg = { moderator_role_id: 'role-mod', auto_role_id: 'auto-borrado', punish_role_id: 'castigo-borrado' };
    const issues = computeConfigIssues(cfg, { channelIds: new Set(), roleIds: new Set(['role-mod']) }, null);

    expect(issues).toContainEqual(expect.objectContaining({ title: 'Rol automático' }));
    expect(issues).toContainEqual(expect.objectContaining({ title: 'Rol de castigo' }));
  });

  it('canal de bienvenida y de confesiones borrados: warnings independientes', () => {
    const cfg = { moderator_role_id: 'role-mod', welcome_channel_id: 'bienvenida-borrado', confession_channel_id: 'confesiones-borrado' };
    const issues = computeConfigIssues(cfg, { channelIds: new Set(), roleIds: new Set(['role-mod']) }, null);

    expect(issues).toContainEqual(expect.objectContaining({ title: 'Canal de bienvenida' }));
    expect(issues).toContainEqual(expect.objectContaining({ title: 'Canal de confesiones' }));
  });

  it('salas de voz activas con canal/categoría borrados: danger', () => {
    const cfg = { moderator_role_id: 'role-mod' };
    const voiceConfig = { enabled: true, createChannelId: 'voz-borrada', categoryId: 'cat-borrada' };
    const issues = computeConfigIssues(cfg, { channelIds: new Set(), roleIds: new Set(['role-mod']) }, voiceConfig);

    expect(issues).toContainEqual(expect.objectContaining({ severity: 'danger', title: 'Salas de voz temporales' }));
  });

  it('salas de voz desactivadas con canal/categoría borrados: NO genera issue (no está en uso)', () => {
    const cfg = { moderator_role_id: 'role-mod' };
    const voiceConfig = { enabled: false, createChannelId: 'voz-borrada', categoryId: 'cat-borrada' };
    const issues = computeConfigIssues(cfg, { channelIds: new Set(), roleIds: new Set(['role-mod']) }, voiceConfig);

    expect(issues.find((i) => i.title === 'Salas de voz temporales')).toBeUndefined();
  });

  it('resourceIds no disponible (fetch de Discord falló): nunca acusa un canal/rol de "borrado" en falso', () => {
    const cfg = {
      moderator_role_id: 'role-mod',
      auto_role_id: 'role-auto',
      punish_role_id: 'role-castigo',
      welcome_channel_id: 'chan-bienvenida',
      confession_channel_id: 'chan-confesiones',
      log_channel_moderation_id: 'chan-mod',
      features: { moderacion: true },
    };
    const issues = computeConfigIssues(cfg, { channelIds: null, roleIds: null }, { enabled: true, createChannelId: 'x', categoryId: 'y' });

    expect(issues).toEqual([]);
  });

  it('config completamente sana (todo configurado y vivo): sin issues', () => {
    const cfg = {
      moderator_role_id: 'role-mod',
      admin_role_id: 'role-mod',
      features: { moderacion: true, xp: true },
      log_channel_moderation_id: 'chan-mod',
      report_channel_id: 'chan-reportes',
      auto_role_id: 'role-auto',
      punish_role_id: 'role-castigo',
      welcome_channel_id: 'chan-bienvenida',
      confession_channel_id: 'chan-confesiones',
    };
    const resourceIds = {
      channelIds: new Set(['chan-mod', 'chan-reportes', 'chan-bienvenida', 'chan-confesiones']),
      roleIds: new Set(['role-mod', 'role-auto', 'role-castigo']),
    };
    const issues = computeConfigIssues(cfg, resourceIds, { enabled: true, createChannelId: 'chan-mod', categoryId: 'chan-mod' });

    expect(issues).toEqual([]);
  });
});

describe('loadGuildDashboardData — expone systemsStatus/configIssues/voiceConfig (Dashboard 2.0)', () => {
  it('el resultado incluye los 3 campos nuevos, calculados sobre guildConfig real', async () => {
    mockLoadGuildDashboardDeps();
    supabaseMock.getBuilder('guild_config').__setResult({
      data: { admin_role_id: 'role-mod', moderator_role_id: 'role-mod', features: { moderacion: true } },
      error: null,
    });
    supabaseMock.getBuilder('voice_channel_config').__setResult({ data: { guild_id: 'guild-1', enabled: true, create_channel_id: 'c', category_id: 'cat' }, error: null });

    const data = await loadGuildDashboardData('guild-1');

    expect(data.voiceConfig).toEqual({ guildId: 'guild-1', createChannelId: 'c', categoryId: 'cat', enabled: true });
    expect(data.systemsStatus.find((s) => s.key === 'tempvoice')).toMatchObject({ status: 'ok' });
    expect(Array.isArray(data.configIssues)).toBe(true);
  });
});
