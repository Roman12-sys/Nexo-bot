import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ARCH-2 (auditoría completa 2026-09-11): lolPatchEngine.js no tenía NINGÚN test propio
// (a diferencia de lolPatchMonitor.js). Acá el foco es exclusivamente la guardia nueva
// contra ticks solapados — mismo patrón exacto que voiceXpEngine.test.js (fetch queda
// colgado a propósito, controlado a mano, para simular el escenario real que motivó el
// fix: un stall de red sin timeout bloqueando el barrido).
const getLastAnnouncedPatchUrl = vi.fn();
const setLastAnnouncedPatchUrl = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/lolPatchStore.js', () => ({ getLastAnnouncedPatchUrl, setLastAnnouncedPatchUrl }));

const getGuildsWithLolAnnounceChannel = vi.fn().mockResolvedValue([]);
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildsWithLolAnnounceChannel }));

const reportCriticalError = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/errorReporter.js', () => ({ reportCriticalError }));

const TICK_MS = 20 * 60 * 1000;
const client = {};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  getLastAnnouncedPatchUrl.mockResolvedValue('https://www.leagueoflegends.com/en-us/news/game-updates/patch-1-0-notes/');
});
afterEach(() => {
  vi.useRealTimers();
});

describe('lolPatchEngine — guardia contra ticks solapados', () => {
  it('si el chequeo anterior todavía no terminó (fetch colgado), el siguiente tick se saltea', async () => {
    vi.resetModules();
    let resolveFetch;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; })));
    const { startLolPatchLoop } = await import('../src/utils/lolPatchEngine.js');

    startLolPatchLoop(client); // dispara el chequeo inicial, que queda colgado en el fetch
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(TICK_MS); // "dispararía" un segundo tick si no hubiera guardia
    expect(fetch).toHaveBeenCalledTimes(1); // se saltó — sigue en 1

    resolveFetch({ ok: true, status: 200, text: () => Promise.resolve('<html></html>') });
    await vi.advanceTimersByTimeAsync(0); // deja terminar el tick colgado (tira porque no hay __NEXT_DATA__, pero libera la guardia)

    await vi.advanceTimersByTimeAsync(TICK_MS); // ahora sí, un tick nuevo puede arrancar
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('un error en un tick no deja la guardia trabada para siempre', async () => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('network down')));
    const { startLolPatchLoop } = await import('../src/utils/lolPatchEngine.js');

    startLolPatchLoop(client);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);

    fetch.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('<html></html>') });
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(fetch).toHaveBeenCalledTimes(2); // el tick siguiente sí pudo arrancar
  });

  it('el fetch de la página de patch notes lleva un AbortSignal (timeout real, no solo de nombre)', async () => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('<html></html>') }));
    const { startLolPatchLoop } = await import('../src/utils/lolPatchEngine.js');

    startLolPatchLoop(client);
    await vi.advanceTimersByTimeAsync(0);

    const [, options] = fetch.mock.calls[0];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
});
