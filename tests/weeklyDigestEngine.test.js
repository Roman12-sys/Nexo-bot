import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// weeklyDigestEngine.js (Ciclo 2, Bloque 11) — barrido periódico sobre guild_config,
// mismo criterio que lolPatchEngine.js: nunca un scheduler nuevo, el estado de "cuándo
// se mandó el último digest" vive en Supabase (weekly_digest_last_sent_at, epoch ms),
// así que un restart nunca pierde ni duplica un envío — el próximo tick vuelve a leer
// ese estado fresco. Lo que importa probar acá es esa lógica (idempotencia, aislamiento
// entre guilds, no-avance-del-reloj-si-falla), no discord.js ni Supabase en sí.
const getGuildsWithWeeklyDigestEnabled = vi.fn();
const setGuildConfig = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildsWithWeeklyDigestEnabled, setGuildConfig }));

const getGuildDailyStats = vi.fn();
vi.mock('../src/utils/guildDailyStatsStore.js', () => ({ getGuildDailyStats }));

const getGuildLogChannel = vi.fn();
vi.mock('../src/utils/guildLogChannels.js', () => ({ getGuildLogChannel }));

const reportCriticalError = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/errorReporter.js', () => ({ reportCriticalError }));

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function makeDay(overrides = {}) {
  return { date: '2026-09-01', messagesSent: 0, commandsExecuted: 0, newMembers: 0, moneyCreated: 0, moneyDestroyed: 0, xpDistributed: 0, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  setGuildConfig.mockResolvedValue(undefined);
  getGuildDailyStats.mockResolvedValue([]);
});

describe('sumWeeklyStats — suma pura de los 7 días', () => {
  it('suma cada columna de forma independiente a través de varios días', async () => {
    const { sumWeeklyStats } = await import('../src/utils/weeklyDigestEngine.js');
    const totals = sumWeeklyStats([
      makeDay({ messagesSent: 10, commandsExecuted: 2, moneyCreated: 100 }),
      makeDay({ messagesSent: 5, newMembers: 1, moneyDestroyed: 50, xpDistributed: 300 }),
    ]);

    expect(totals).toEqual({ messagesSent: 15, commandsExecuted: 2, newMembers: 1, moneyCreated: 100, moneyDestroyed: 50, xpDistributed: 300 });
  });

  it('sin días (guild sin actividad todavía): todo en cero, no undefined/NaN', async () => {
    const { sumWeeklyStats } = await import('../src/utils/weeklyDigestEngine.js');
    expect(sumWeeklyStats([])).toEqual({ messagesSent: 0, commandsExecuted: 0, newMembers: 0, moneyCreated: 0, moneyDestroyed: 0, xpDistributed: 0 });
  });
});

describe('buildDigestEmbed', () => {
  it('refleja los totales en los campos del embed', async () => {
    const { buildDigestEmbed } = await import('../src/utils/weeklyDigestEngine.js');
    const embed = buildDigestEmbed({ messagesSent: 42, commandsExecuted: 7, newMembers: 3, moneyCreated: 1000, moneyDestroyed: 200, xpDistributed: 5000 });

    const value = (name) => embed.data.fields.find((f) => f.name.includes(name)).value;
    expect(value('Mensajes')).toBe('42');
    expect(value('Comandos')).toBe('7');
    expect(value('nuevos')).toBe('3');
    expect(value('generadas')).toBe('1000');
    expect(value('destruidas')).toBe('200');
    expect(value('XP')).toBe('5000');
  });
});

describe('runDigestSweep — idempotencia, aislamiento y no-duplicados', () => {
  it('guild recién activado (lastSentAt null): siembra la fecha SIN mandar nada', async () => {
    const { runDigestSweep } = await import('../src/utils/weeklyDigestEngine.js');
    getGuildsWithWeeklyDigestEnabled.mockResolvedValue([{ guildId: 'g-nuevo', lastSentAt: null }]);

    await runDigestSweep({});

    expect(getGuildLogChannel).not.toHaveBeenCalled();
    expect(setGuildConfig).toHaveBeenCalledTimes(1);
    expect(setGuildConfig).toHaveBeenCalledWith('g-nuevo', { weekly_digest_last_sent_at: expect.any(Number) });
  });

  it('todavía no pasó la semana: no manda nada ni toca weekly_digest_last_sent_at', async () => {
    const { runDigestSweep } = await import('../src/utils/weeklyDigestEngine.js');
    getGuildsWithWeeklyDigestEnabled.mockResolvedValue([{ guildId: 'g-1', lastSentAt: Date.now() - 3 * DAY_MS }]);

    await runDigestSweep({});

    expect(getGuildLogChannel).not.toHaveBeenCalled();
    expect(setGuildConfig).not.toHaveBeenCalled();
  });

  it('pasó la semana y hay canal configurado: manda el digest con los totales reales y avanza el reloj', async () => {
    const { runDigestSweep } = await import('../src/utils/weeklyDigestEngine.js');
    const send = vi.fn().mockResolvedValue(undefined);
    getGuildsWithWeeklyDigestEnabled.mockResolvedValue([{ guildId: 'g-1', lastSentAt: Date.now() - WEEK_MS - 1 }]);
    getGuildLogChannel.mockResolvedValue({ send });
    getGuildDailyStats.mockResolvedValue([makeDay({ messagesSent: 20 }), makeDay({ messagesSent: 30 })]);

    await runDigestSweep({});

    expect(getGuildDailyStats).toHaveBeenCalledWith('g-1', 7);
    expect(send).toHaveBeenCalledTimes(1);
    const embed = send.mock.calls[0][0].embeds[0];
    expect(embed.data.fields.find((f) => f.name.includes('Mensajes')).value).toBe('50');
    expect(setGuildConfig).toHaveBeenCalledWith('g-1', { weekly_digest_last_sent_at: expect.any(Number) });
  });

  it('pasó la semana pero NO hay canal de logs de actividad: no manda nada y NO avanza el reloj (se reintenta el próximo tick)', async () => {
    const { runDigestSweep } = await import('../src/utils/weeklyDigestEngine.js');
    getGuildsWithWeeklyDigestEnabled.mockResolvedValue([{ guildId: 'g-1', lastSentAt: Date.now() - WEEK_MS - 1 }]);
    getGuildLogChannel.mockResolvedValue(null);

    await runDigestSweep({});

    expect(setGuildConfig).not.toHaveBeenCalled();
  });

  it('el envío falla (rate limit/permisos): no revienta el barrido y NO avanza el reloj', async () => {
    const { runDigestSweep } = await import('../src/utils/weeklyDigestEngine.js');
    getGuildsWithWeeklyDigestEnabled.mockResolvedValue([{ guildId: 'g-1', lastSentAt: Date.now() - WEEK_MS - 1 }]);
    getGuildLogChannel.mockResolvedValue({ send: vi.fn().mockRejectedValue(new Error('Missing Access')) });

    await expect(runDigestSweep({})).resolves.not.toThrow();
    expect(setGuildConfig).not.toHaveBeenCalled();
  });

  it('aislamiento entre guilds: un guild roto no frena el envío de los demás', async () => {
    const { runDigestSweep } = await import('../src/utils/weeklyDigestEngine.js');
    const sendOk = vi.fn().mockResolvedValue(undefined);
    getGuildsWithWeeklyDigestEnabled.mockResolvedValue([
      { guildId: 'g-roto', lastSentAt: Date.now() - WEEK_MS - 1 },
      { guildId: 'g-ok', lastSentAt: Date.now() - WEEK_MS - 1 },
    ]);
    getGuildLogChannel.mockImplementation(async (_client, guildId) => {
      if (guildId === 'g-roto') throw new Error('canal inaccesible');
      return { send: sendOk };
    });

    await expect(runDigestSweep({})).resolves.not.toThrow();

    expect(sendOk).toHaveBeenCalledTimes(1);
    expect(setGuildConfig).toHaveBeenCalledWith('g-ok', { weekly_digest_last_sent_at: expect.any(Number) });
    expect(setGuildConfig).not.toHaveBeenCalledWith('g-roto', expect.anything());
  });

  it('no duplica entre guilds: cada uno avanza SOLO su propia fila de weekly_digest_last_sent_at', async () => {
    const { runDigestSweep } = await import('../src/utils/weeklyDigestEngine.js');
    getGuildsWithWeeklyDigestEnabled.mockResolvedValue([
      { guildId: 'g-a', lastSentAt: Date.now() - WEEK_MS - 1 },
      { guildId: 'g-b', lastSentAt: Date.now() - WEEK_MS - 1 },
    ]);
    getGuildLogChannel.mockResolvedValue({ send: vi.fn().mockResolvedValue(undefined) });

    await runDigestSweep({});

    expect(setGuildConfig).toHaveBeenCalledTimes(2);
    expect(setGuildConfig).toHaveBeenCalledWith('g-a', { weekly_digest_last_sent_at: expect.any(Number) });
    expect(setGuildConfig).toHaveBeenCalledWith('g-b', { weekly_digest_last_sent_at: expect.any(Number) });
  });

  it('restart conceptual: dos sweeps independientes con el mismo estado de entrada (nada en memoria) se comportan igual', async () => {
    // No hay ningún Map/estado en memoria en este módulo aparte de la guardia de
    // solapamiento (tickRunning, cubierta aparte) — runDigestSweep(client) es una
    // función pura respecto del proceso: todo lo que necesita para decidir viene de
    // Supabase en cada llamada. Simula "el bot reinició entre tick y tick" llamando dos
    // veces seguidas con el mismo mock de entrada.
    const { runDigestSweep } = await import('../src/utils/weeklyDigestEngine.js');
    getGuildsWithWeeklyDigestEnabled.mockResolvedValue([{ guildId: 'g-1', lastSentAt: Date.now() - WEEK_MS - 1 }]);
    getGuildLogChannel.mockResolvedValue({ send: vi.fn().mockResolvedValue(undefined) });

    await runDigestSweep({});
    expect(setGuildConfig).toHaveBeenCalledTimes(1);

    // "Reinicio": el mock vuelve a devolver el mismo lastSentAt viejo, como si el
    // update de arriba nunca se hubiera guardado en la base real — el sweep decide de
    // nuevo desde cero sin depender de haber corrido antes en este mismo proceso.
    await runDigestSweep({});
    expect(setGuildConfig).toHaveBeenCalledTimes(2);
  });
});

describe('startWeeklyDigestLoop — guardia contra ticks solapados', () => {
  const TICK_MS = 60 * 60 * 1000;

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('si el tick anterior todavía no terminó, el siguiente se saltea (no vuelve a consultar guilds)', async () => {
    vi.resetModules();
    getGuildsWithWeeklyDigestEnabled.mockReset();
    let resolveGuilds;
    getGuildsWithWeeklyDigestEnabled.mockImplementation(() => new Promise((resolve) => { resolveGuilds = resolve; }));
    const { startWeeklyDigestLoop } = await import('../src/utils/weeklyDigestEngine.js');

    startWeeklyDigestLoop({});

    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(getGuildsWithWeeklyDigestEnabled).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(TICK_MS); // "dispararía" un segundo tick si no hubiera guardia
    expect(getGuildsWithWeeklyDigestEnabled).toHaveBeenCalledTimes(1);

    resolveGuilds([]);
    await vi.advanceTimersByTimeAsync(0); // deja terminar el primer tick

    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(getGuildsWithWeeklyDigestEnabled).toHaveBeenCalledTimes(2);
  });

  it('un error en un tick no deja la guardia trabada para siempre', async () => {
    vi.resetModules();
    getGuildsWithWeeklyDigestEnabled.mockReset();
    getGuildsWithWeeklyDigestEnabled.mockRejectedValueOnce(new Error('supabase caído'));
    const { startWeeklyDigestLoop } = await import('../src/utils/weeklyDigestEngine.js');

    startWeeklyDigestLoop({});

    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(getGuildsWithWeeklyDigestEnabled).toHaveBeenCalledTimes(1);

    getGuildsWithWeeklyDigestEnabled.mockResolvedValue([]);
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(getGuildsWithWeeklyDigestEnabled).toHaveBeenCalledTimes(2);
  });
});
