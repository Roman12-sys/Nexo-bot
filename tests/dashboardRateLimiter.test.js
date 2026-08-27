import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rateLimitMiddleware } from '../dashboard/rateLimiter.js';

// Auditoría 2026-08-27: el dashboard no tenía NINGÚN límite por IP — cualquier ruta
// (incluso /auth/login, antes de tener sesión) se podía golpear sin límite.

function makeReq(ip, forwarded) {
  return {
    headers: forwarded ? { 'x-forwarded-for': forwarded } : {},
    socket: { remoteAddress: ip },
  };
}

function makeRes() {
  const res = { statusCode: null, body: null };
  res.status = vi.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.send = vi.fn((body) => {
    res.body = body;
    return res;
  });
  return res;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('rateLimitMiddleware', () => {
  it('deja pasar requests por debajo del límite', () => {
    const req = makeReq('1.2.3.4');
    const res = makeRes();
    const next = vi.fn();

    for (let i = 0; i < 60; i++) rateLimitMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(60);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('bloquea con 429 al superar el límite dentro de la ventana', () => {
    const req = makeReq('5.5.5.5');
    const res = makeRes();
    const next = vi.fn();

    for (let i = 0; i < 61; i++) rateLimitMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(60);
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('usa la primera IP de X-Forwarded-For (la del cliente real detrás del proxy)', () => {
    const req = makeReq('10.0.0.1', '9.9.9.9, 10.0.0.1');
    const res = makeRes();
    const next = vi.fn();

    for (let i = 0; i < 61; i++) rateLimitMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);

    // Otra IP distinta (sin forwarded) no debería estar afectada por el límite de arriba.
    const otherReq = makeReq('1.1.1.1');
    const otherRes = makeRes();
    const otherNext = vi.fn();
    rateLimitMiddleware(otherReq, otherRes, otherNext);
    expect(otherNext).toHaveBeenCalledTimes(1);
    expect(otherRes.status).not.toHaveBeenCalled();
  });

  it('IPs distintas tienen cupos independientes', () => {
    const resA = makeRes();
    const nextA = vi.fn();
    for (let i = 0; i < 60; i++) rateLimitMiddleware(makeReq('2.2.2.2'), resA, nextA);
    expect(resA.status).not.toHaveBeenCalled();

    const resB = makeRes();
    const nextB = vi.fn();
    rateLimitMiddleware(makeReq('3.3.3.3'), resB, nextB);
    expect(nextB).toHaveBeenCalledTimes(1);
    expect(resB.status).not.toHaveBeenCalled();
  });

  it('pasada la ventana de 60s, el cupo se libera', () => {
    const req = makeReq('7.7.7.7');
    const res = makeRes();
    const next = vi.fn();

    for (let i = 0; i < 60; i++) rateLimitMiddleware(req, res, next);
    vi.advanceTimersByTime(61_000);

    const res2 = makeRes();
    const next2 = vi.fn();
    rateLimitMiddleware(req, res2, next2);
    expect(next2).toHaveBeenCalledTimes(1);
    expect(res2.status).not.toHaveBeenCalled();
  });
});
