import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { registerShutdown } from '../src/utils/shutdown.js';

// registerShutdown se comparte entre el bot (src/index.js) y el dashboard
// (dashboard/server.js) — se prueba acá aislado de discord.js/Express: lo único que le
// importa a esta pieza es "no correr cleanup() dos veces" y "salir con el código
// correcto según si cleanup() tiró o no".
describe('registerShutdown', () => {
  let exitSpy;
  let onSpy;
  const registeredSignals = [];

  beforeEach(() => {
    registeredSignals.length = 0;
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
    onSpy = vi.spyOn(process, 'on').mockImplementation((signal, handler) => {
      registeredSignals.push({ signal, handler });
      return process;
    });
  });

  afterEach(() => {
    exitSpy.mockRestore();
    onSpy.mockRestore();
  });

  it('registra un listener por cada señal pedida', () => {
    registerShutdown(['SIGTERM', 'SIGINT'], async () => {});

    expect(registeredSignals.map((r) => r.signal)).toEqual(['SIGTERM', 'SIGINT']);
  });

  it('corre cleanup() y sale con código 0 cuando todo sale bien', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const handle = registerShutdown(['SIGTERM'], cleanup);

    await handle('SIGTERM');

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('sale con código 1 si cleanup() tira', async () => {
    const cleanup = vi.fn().mockRejectedValue(new Error('boom'));
    const handle = registerShutdown(['SIGTERM'], cleanup);

    await handle('SIGTERM');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('una segunda señal (incluso de otro tipo) no vuelve a correr cleanup()', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const handle = registerShutdown(['SIGTERM', 'SIGINT'], cleanup);

    await handle('SIGTERM');
    await handle('SIGINT');
    await handle('SIGTERM');

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledTimes(1);
  });
});
