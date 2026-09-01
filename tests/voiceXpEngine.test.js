import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// voiceXpEngine.js — Fase 2C, sección 8: setInterval no espera a que un tick termine
// antes de disparar el siguiente. grantVoiceXpTick recorre guilds/canales/miembros en
// secuencia con awaits reales a Supabase — con muchos servidores y mucha gente en voz,
// un barrido puede tardar más que TICK_MS. Sin una guardia, dos barridos solapados
// podían darle XP doble a quien siguiera conectado en los dos. Lo que importa probar acá
// es la guardia en sí, no la lógica de otorgamiento de XP (ya existía, sin cambios).
//
// vi.resetModules() + re-import en cada test: la guardia (tickRunning) es una variable
// module-level, a propósito sin exportar (no hace falta que nada más la lea) — sin
// resetear el módulo entre tests, el estado de un test se filtraría al siguiente.
const getGuildConfig = vi.fn();
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig }));

vi.mock('../src/utils/xpStore.js', () => ({
  addXp: vi.fn().mockResolvedValue({ leveledUp: false }),
  getUserXp: vi.fn().mockResolvedValue({ xpBoostUntil: 0 }),
  XP_BOOST_MULTIPLIER: 2,
}));

vi.mock('../src/utils/xpEngine.js', () => ({
  processLevelUp: vi.fn().mockResolvedValue(undefined),
  getGuildXpMultiplier: vi.fn().mockReturnValue(1),
}));

function makeClient(guildIds) {
  const guilds = guildIds.map((id) => ({ id, name: `guild-${id}`, afkChannelId: null, channels: { cache: new Map() } }));
  return { guilds: { cache: new Map(guilds.map((g) => [g.id, g])) } };
}

const TICK_MS = 5 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('voiceXpEngine — guardia contra ticks solapados', () => {
  it('si el tick anterior todavía no terminó, el siguiente se saltea (no llama getGuildConfig de nuevo)', async () => {
    vi.resetModules();
    getGuildConfig.mockReset();
    let resolveConfig;
    getGuildConfig.mockImplementation(() => new Promise((resolve) => { resolveConfig = resolve; }));
    const { startVoiceXpLoop } = await import('../src/utils/voiceXpEngine.js');

    const client = makeClient(['guild-1']);
    startVoiceXpLoop(client);

    await vi.advanceTimersByTimeAsync(TICK_MS); // dispara el primer tick, queda colgado esperando getGuildConfig
    expect(getGuildConfig).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(TICK_MS); // "dispararía" un segundo tick si no hubiera guardia
    expect(getGuildConfig).toHaveBeenCalledTimes(1); // se saltó — sigue en 1

    resolveConfig({ features: { xp: false } });
    await vi.advanceTimersByTimeAsync(0); // deja terminar el primer tick

    await vi.advanceTimersByTimeAsync(TICK_MS); // ahora sí, un tick nuevo puede arrancar
    expect(getGuildConfig).toHaveBeenCalledTimes(2);
  });

  it('un error en un tick no deja la guardia trabada para siempre', async () => {
    vi.resetModules();
    getGuildConfig.mockReset();
    getGuildConfig.mockRejectedValueOnce(new Error('supabase caído'));
    const { startVoiceXpLoop } = await import('../src/utils/voiceXpEngine.js');

    const client = makeClient(['guild-1']);
    startVoiceXpLoop(client);

    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(getGuildConfig).toHaveBeenCalledTimes(1);

    getGuildConfig.mockResolvedValue({ features: { xp: false } });
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(getGuildConfig).toHaveBeenCalledTimes(2); // el tick siguiente sí pudo arrancar
  });
});
