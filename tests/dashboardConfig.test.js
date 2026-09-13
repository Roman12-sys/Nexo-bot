import { vi, describe, it, expect, afterEach } from 'vitest';

// Auditoría 2026-09-12: required() solo chequeaba "no vacío" — un
// DASHBOARD_SESSION_SECRET corto/adivinable sería forjable por fuerza bruta offline
// contra la firma HMAC-SHA256 de session.js. Este archivo no existía antes de ese
// hallazgo.
const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function setBaseEnv(sessionSecret) {
  process.env.CLIENT_SECRET = 'client-secret';
  process.env.DASHBOARD_SESSION_SECRET = sessionSecret;
  process.env.DASHBOARD_BASE_URL = 'https://dashboard.ejemplo.test';
}

describe('dashboard/config.js — mínimo de longitud de DASHBOARD_SESSION_SECRET', () => {
  it('un secreto corto (<32 caracteres) no deja arrancar el proceso', async () => {
    setBaseEnv('demasiado-corto');
    vi.resetModules();

    await expect(import('../dashboard/config.js')).rejects.toThrow(/DASHBOARD_SESSION_SECRET.*corto/i);
  });

  it('un secreto de 32+ caracteres arranca sin problema', async () => {
    setBaseEnv('a'.repeat(32));
    vi.resetModules();

    const { dashboardConfig } = await import('../dashboard/config.js');
    expect(dashboardConfig.sessionSecret).toBe('a'.repeat(32));
  });
});
