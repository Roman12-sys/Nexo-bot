import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkRateLimit } from '../src/utils/rateLimiter.js';

describe('checkRateLimit', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('permite hasta 10 acciones dentro de la ventana', () => {
    const userId = `user-${Math.random()}`;
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit(userId)).toBe(true);
    }
  });

  it('bloquea la acción número 11 dentro de la misma ventana', () => {
    const userId = `user-${Math.random()}`;
    for (let i = 0; i < 10; i++) checkRateLimit(userId);
    expect(checkRateLimit(userId)).toBe(false);
  });

  it('usuarios distintos no comparten el límite', () => {
    const userA = `user-a-${Math.random()}`;
    const userB = `user-b-${Math.random()}`;
    for (let i = 0; i < 10; i++) checkRateLimit(userA);

    expect(checkRateLimit(userA)).toBe(false);
    expect(checkRateLimit(userB)).toBe(true);
  });

  it('vuelve a permitir pasada la ventana de 10 segundos', () => {
    vi.useFakeTimers();
    const userId = `user-${Math.random()}`;
    for (let i = 0; i < 10; i++) checkRateLimit(userId);
    expect(checkRateLimit(userId)).toBe(false);

    vi.advanceTimersByTime(10_001);

    expect(checkRateLimit(userId)).toBe(true);
  });
});
