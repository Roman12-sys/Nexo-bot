import { vi, describe, it, expect, beforeEach } from 'vitest';

// EventBus es infraestructura central (Event Engine) de la que dependen misiones,
// logros y analítica diaria — Fase A de la segunda auditoría (2026-08-30) la dejó sin
// un solo test pese a eso. Lo único que hace falta proteger acá es el contrato que todo
// lo demás asume: un handler roto no debe tumbar a los demás, y emit() nunca debe
// rechazar (si lo hiciera, los `.catch(() => {})` de los call-sites en
// economyStore/xpStore/commandUsageStore no alcanzarían para evitar un
// unhandledRejection).
const { EventBus } = await import('../src/utils/eventBus.js');

describe('EventBus.emit', () => {
  let bus;
  beforeEach(() => {
    bus = new EventBus();
  });

  it('corre todos los handlers registrados para un evento', async () => {
    const a = vi.fn().mockResolvedValue(undefined);
    const b = vi.fn().mockResolvedValue(undefined);
    bus.on('X', a);
    bus.on('X', b);

    await bus.emit('X', { valor: 1 });

    expect(a).toHaveBeenCalledWith({ valor: 1 });
    expect(b).toHaveBeenCalledWith({ valor: 1 });
  });

  it('un handler que rechaza no impide que los demás corran', async () => {
    const roto = vi.fn().mockRejectedValue(new Error('boom'));
    const sano = vi.fn().mockResolvedValue(undefined);
    bus.on('X', roto);
    bus.on('X', sano);

    await expect(bus.emit('X', {})).resolves.toBeUndefined();
    expect(sano).toHaveBeenCalledTimes(1);
  });

  it('un handler que tira sincrónicamente tampoco impide que los demás corran', async () => {
    const roto = vi.fn(() => {
      throw new Error('boom sincrónico');
    });
    const sano = vi.fn().mockResolvedValue(undefined);
    bus.on('X', roto);
    bus.on('X', sano);

    await expect(bus.emit('X', {})).resolves.toBeUndefined();
    expect(sano).toHaveBeenCalledTimes(1);
  });

  it('un evento sin handlers registrados no revienta', async () => {
    await expect(bus.emit('SIN_HANDLERS', {})).resolves.toBeUndefined();
  });

  it('un handler roto se loguea con el nombre del evento (observabilidad mínima)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    bus.on('X', () => Promise.reject(new Error('boom')));

    await bus.emit('X', {});

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('X'), expect.any(Error));
    errorSpy.mockRestore();
  });
});
