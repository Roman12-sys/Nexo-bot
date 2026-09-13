import { vi, describe, it, expect, afterEach } from 'vitest';

// Auditoría 2026-09-12: logPurgeEngine.js era el único de los 6 loops periódicos del
// proyecto sin conexión a la alerta operativa (reportCriticalError) — si el barrido
// fallaba a nivel top, la purga de logs se detenía en todos los servidores para
// siempre, sin que nadie se enterara. Este archivo no existía antes de ese hallazgo.
const getGuildLogChannel = vi.fn();
vi.mock('../src/utils/guildLogChannels.js', () => ({ getGuildLogChannel }));

const reportCriticalError = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/errorReporter.js', () => ({ reportCriticalError }));

const TICK_MS = 12 * 60 * 60 * 1000;

afterEach(() => {
  vi.useRealTimers();
});

describe('startLogPurgeLoop — conectado a reportCriticalError', () => {
  it('si el tick falla a nivel top, se reporta como error crítico (antes: solo console.error)', async () => {
    vi.useFakeTimers();
    const { startLogPurgeLoop } = await import('../src/utils/logPurgeEngine.js');
    // guilds.cache sin .values() fuerza un error ANTES de que cualquier try/catch por
    // guild/categoría pueda atraparlo — simula un fallo real a nivel del tick entero.
    const badClient = { guilds: { cache: {} } };

    startLogPurgeLoop(badClient);
    await vi.advanceTimersByTimeAsync(TICK_MS);

    expect(reportCriticalError).toHaveBeenCalledWith(badClient, expect.stringContaining('logPurgeEngine'), expect.any(Error));
  });
});
