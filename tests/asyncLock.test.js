import { vi, describe, it, expect, beforeEach } from 'vitest';

// Auditoría adversarial round 2, Bloque 2 — withLock() no tenía timeout: una `fn`
// que nunca resuelve (stall real de red, un bug que deja un await colgado) dejaba esa
// key bloqueada PARA SIEMPRE, sin ningún error visible, hasta el próximo reinicio del
// proceso. Estos tests prueban el timeout nuevo: se libera la key, se reporta como
// error crítico, y la operación colgada nunca vuelve a bloquear a nadie más.
const reportCriticalError = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/errorReporter.js', () => ({ reportCriticalError }));

const { withLock, LockTimeoutError, DEFAULT_LOCK_TIMEOUT_MS } = await import('../src/utils/asyncLock.js');

function neverResolves() {
  return new Promise(() => {});
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('withLock — comportamiento normal (sin timeout de por medio)', () => {
  it('devuelve el resultado real de una operación exitosa', async () => {
    const result = await withLock('k-normal', async () => 'ok');
    expect(result).toBe('ok');
  });

  it('propaga una excepción lanzada dentro de fn, y la key queda libre para el siguiente caller', async () => {
    await expect(withLock('k-throw', async () => { throw new Error('boom'); })).rejects.toThrow('boom');

    // El siguiente caller sobre la MISMA key no queda esperando nada raro.
    const result = await withLock('k-throw', async () => 'sigo andando');
    expect(result).toBe('sigo andando');
  });

  it('propaga una Promise rechazada dentro de fn, y la key queda libre para el siguiente caller', async () => {
    await expect(withLock('k-reject', () => Promise.reject(new Error('rechazada')))).rejects.toThrow('rechazada');

    const result = await withLock('k-reject', async () => 'sigo andando');
    expect(result).toBe('sigo andando');
  });

  it('serializa dos operaciones sobre la misma key: la segunda arranca recién cuando la primera termina', async () => {
    const order = [];
    const first = withLock('k-serial', async () => {
      order.push('first-start');
      await new Promise((r) => setTimeout(r, 20));
      order.push('first-end');
      return 'first';
    });
    const second = withLock('k-serial', async () => {
      order.push('second-start');
      return 'second';
    });

    const [r1, r2] = await Promise.all([first, second]);
    expect(r1).toBe('first');
    expect(r2).toBe('second');
    expect(order).toEqual(['first-start', 'first-end', 'second-start']);
  });

  it('dos keys distintas nunca se bloquean entre sí', async () => {
    const order = [];
    const slow = withLock('k-a', async () => {
      order.push('a-start');
      await new Promise((r) => setTimeout(r, 30));
      order.push('a-end');
    });
    const fast = withLock('k-b', async () => {
      order.push('b-start-and-end');
    });

    await Promise.all([slow, fast]);
    // "b" no esperó a que "a" terminara — corrió y terminó ANTES de que "a" avisara su fin.
    expect(order.indexOf('b-start-and-end')).toBeLessThan(order.indexOf('a-end'));
  });
});

describe('withLock — timeout', () => {
  it('rechaza con LockTimeoutError si fn nunca resuelve dentro del timeout', async () => {
    await expect(withLock('k-hang', neverResolves, { timeoutMs: 20 })).rejects.toThrow(LockTimeoutError);
  });

  it('caso clave: lock colgado -> timeout -> la key queda liberada -> la siguiente operación sobre la MISMA key funciona sin esperar a la colgada', async () => {
    const hung = withLock('k-hang-then-free', neverResolves, { timeoutMs: 20 });
    // No lo esperamos con await todavía (nunca resolvería) — dejamos que rechace
    // por su cuenta y confirmamos que el SIGUIENTE caller no queda atado a esa espera.
    hung.catch(() => {}); // evita un "unhandled rejection" ruidoso en el test

    const start = Date.now();
    const next = await withLock('k-hang-then-free', async () => 'libre', { timeoutMs: 5000 });
    const elapsed = Date.now() - start;

    expect(next).toBe('libre');
    // La segunda operación tuvo que esperar aproximadamente el timeout de la primera
    // (20ms), nunca los 5000ms de SU PROPIO timeout ni quedar colgada para siempre.
    expect(elapsed).toBeLessThan(1000);

    await expect(hung).rejects.toThrow(LockTimeoutError);
  });

  it('reporta el timeout como error crítico exactamente una vez', async () => {
    const hung = withLock('k-hang-report', neverResolves, { timeoutMs: 15 });
    await expect(hung).rejects.toThrow(LockTimeoutError);

    // reportCriticalError se llama de forma fire-and-forget dentro de withLock — dar
    // un tick para que la promesa interna corra antes de verificar.
    await new Promise((r) => setTimeout(r, 5));
    expect(reportCriticalError).toHaveBeenCalledTimes(1);
    expect(reportCriticalError.mock.calls[0][1]).toContain('k-hang-report');
  });

  it('timeoutMs: 0 desactiva el timeout — una operación legítimamente lenta no se corta', async () => {
    const result = await withLock(
      'k-no-timeout',
      async () => {
        await new Promise((r) => setTimeout(r, 40));
        return 'terminé sin apuro';
      },
      { timeoutMs: 0 },
    );
    expect(result).toBe('terminé sin apuro');
  });

  it('usa DEFAULT_LOCK_TIMEOUT_MS cuando no se pasa timeoutMs, y está entre 15s y 30s', () => {
    expect(DEFAULT_LOCK_TIMEOUT_MS).toBeGreaterThanOrEqual(15_000);
    expect(DEFAULT_LOCK_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });

  it('una operación que completa un poco después del timeout no vuelve a bloquear la key (ya está libre) y queda logueada, no silenciada', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const late = withLock(
        'k-late-success',
        async () => {
          await new Promise((r) => setTimeout(r, 30));
          return 'llegué tarde pero llegué';
        },
        { timeoutMs: 10 },
      );
      await expect(late).rejects.toThrow(LockTimeoutError);

      // La key ya está libre inmediatamente después del timeout (no hay que esperar
      // a que la operación tardía realmente termine).
      const next = await withLock('k-late-success', async () => 'ya libre');
      expect(next).toBe('ya libre');

      // Esperar a que la operación tardía realmente resuelva y quede logueada.
      await new Promise((r) => setTimeout(r, 40));
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('completó DESPUÉS del timeout'));
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
