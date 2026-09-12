import { vi, describe, it, expect, beforeEach } from 'vitest';

// botOwner.js — plan de ejecución post-auditoría, Fase 5 (2026-09-12). Gate exclusivo
// de /owner-metricas: NUNCA un rol de guild_config, siempre el dueño real de la app de
// Discord vía REST. Mismo gotcha ya documentado en CLAUDE.md para el caso análogo de
// Spotify: si la app está bajo un Team (el caso de NEXO), el owner real está en
// team.owner_user_id, no en `owner.id`.
//
// isBotOwner() cachea el resultado a nivel de módulo (5 min) — vi.resetModules() +
// reimport en cada test evita que un test vea el cache poblado por el anterior.
vi.mock('../src/config.js', () => ({ config: { discordToken: 'test-token' } }));

function mockFetchOnce(body, ok = true) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 403, json: async () => body }));
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('isBotOwner', () => {
  it('app con dueño individual: compara contra owner.id', async () => {
    mockFetchOnce({ owner: { id: 'user-real-owner' } });
    const { isBotOwner } = await import('../src/utils/botOwner.js');

    expect(await isBotOwner('user-real-owner')).toBe(true);
  });

  it('app bajo un Team (caso NEXO): usa team.owner_user_id, NUNCA owner.id (que sería el team)', async () => {
    mockFetchOnce({ owner: { id: 'team-id-no-es-una-persona' }, team: { owner_user_id: 'user-real-owner' } });
    const { isBotOwner } = await import('../src/utils/botOwner.js');

    expect(await isBotOwner('user-real-owner')).toBe(true);
    expect(await isBotOwner('team-id-no-es-una-persona')).toBe(false);
  });

  it('usuario que no es el dueño: false', async () => {
    mockFetchOnce({ owner: { id: 'user-real-owner' } });
    const { isBotOwner } = await import('../src/utils/botOwner.js');

    expect(await isBotOwner('un-admin-cualquiera')).toBe(false);
  });

  it('resultados dentro de la ventana de cache: una sola llamada real a Discord', async () => {
    mockFetchOnce({ owner: { id: 'user-real-owner' } });
    const { isBotOwner } = await import('../src/utils/botOwner.js');

    await isBotOwner('user-real-owner');
    await isBotOwner('otro-usuario');

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('la request usa el token real del bot', async () => {
    mockFetchOnce({ owner: { id: 'user-real-owner' } });
    const { isBotOwner } = await import('../src/utils/botOwner.js');

    await isBotOwner('user-real-owner');

    expect(fetch).toHaveBeenCalledWith(
      'https://discord.com/api/v10/oauth2/applications/@me',
      expect.objectContaining({ headers: { Authorization: 'Bot test-token' } }),
    );
  });

  it('la API de Discord responde con error: se propaga, nunca se cachea un dueño falso', async () => {
    mockFetchOnce({}, false);
    const { isBotOwner } = await import('../src/utils/botOwner.js');

    await expect(isBotOwner('cualquiera')).rejects.toThrow('status 403');
  });
});
