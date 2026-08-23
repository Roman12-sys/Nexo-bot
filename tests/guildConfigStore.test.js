import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createSupabaseMock } from './helpers/supabaseMock.js';

// guild_config es la tabla de la que depende CASI todo (isStaff, logs, XP, extras de
// /setup) — el cache de 30s (ver CLAUDE.md) es lo que evita pegarle a Supabase en cada
// mensaje/comando. Un bug acá (ej. una key de cache compartida entre servers) sería del
// tipo "silencioso pero grave": un server vería la config de otro.
const supabaseMock = createSupabaseMock();
vi.mock('../src/supabaseClient.js', () => ({ get supabase() { return supabaseMock; } }));

const { getGuildConfig, setGuildConfig, invalidateGuildConfig } = await import('../src/utils/guildConfigStore.js');

beforeEach(() => {
  vi.clearAllMocks();
  supabaseMock.getBuilder('guild_config').__setResult({ data: null, error: null });
  invalidateGuildConfig('guild-1');
  invalidateGuildConfig('guild-2');
});

describe('getGuildConfig', () => {
  it('server sin fila todavía en guild_config devuelve la config por defecto (todo null/vacío)', async () => {
    const cfg = await getGuildConfig('guild-nuevo');

    expect(cfg.guild_id).toBe('guild-nuevo');
    expect(cfg.admin_role_id).toBeNull();
    expect(cfg.moderator_role_id).toBeNull();
    expect(cfg.level_roles).toEqual({});
  });

  it('dentro de los 30s de cache, una segunda consulta no vuelve a pegarle a Supabase', async () => {
    supabaseMock.getBuilder('guild_config').__setResult({ data: { guild_id: 'guild-1', admin_role_id: 'role-admin' }, error: null });

    await getGuildConfig('guild-1');
    await getGuildConfig('guild-1');

    expect(supabaseMock.from).toHaveBeenCalledTimes(1);
  });

  it('invalidateGuildConfig fuerza a que la siguiente consulta vuelva a pegarle a Supabase', async () => {
    supabaseMock.getBuilder('guild_config').__setResult({ data: { guild_id: 'guild-1', admin_role_id: 'role-admin' }, error: null });

    await getGuildConfig('guild-1');
    invalidateGuildConfig('guild-1');
    await getGuildConfig('guild-1');

    expect(supabaseMock.from).toHaveBeenCalledTimes(2);
  });
});

describe('aislamiento entre servidores', () => {
  it('la config cacheada de un guild nunca se devuelve para otro guild', async () => {
    supabaseMock.getBuilder('guild_config').__setResult({ data: { guild_id: 'guild-1', admin_role_id: 'role-de-guild-1' }, error: null });
    const cfgGuild1 = await getGuildConfig('guild-1');

    supabaseMock.getBuilder('guild_config').__setResult({ data: { guild_id: 'guild-2', admin_role_id: 'role-de-guild-2' }, error: null });
    const cfgGuild2 = await getGuildConfig('guild-2');

    expect(cfgGuild1.admin_role_id).toBe('role-de-guild-1');
    expect(cfgGuild2.admin_role_id).toBe('role-de-guild-2');

    // Repetir guild-1 (todavía en cache) NO debe traer lo de guild-2.
    const cfgGuild1DeNuevo = await getGuildConfig('guild-1');
    expect(cfgGuild1DeNuevo.admin_role_id).toBe('role-de-guild-1');
  });
});

describe('setGuildConfig', () => {
  it('guarda el patch y deja la cache actualizada sin esperar al próximo TTL', async () => {
    const upsert = supabaseMock.getBuilder('guild_config').upsert;
    supabaseMock.getBuilder('guild_config').__setResult({
      data: { guild_id: 'guild-1', admin_role_id: 'role-nuevo' },
      error: null,
    });

    const saved = await setGuildConfig('guild-1', { admin_role_id: 'role-nuevo' });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ guild_id: 'guild-1', admin_role_id: 'role-nuevo' }),
      expect.anything(),
    );
    expect(saved.admin_role_id).toBe('role-nuevo');

    // Cambiamos lo que devolvería Supabase para probar que esta lectura viene de la
    // cache recién escrita, no de un nuevo round-trip.
    supabaseMock.getBuilder('guild_config').__setResult({ data: { guild_id: 'guild-1', admin_role_id: 'otro-valor' }, error: null });
    const readAfter = await getGuildConfig('guild-1');
    expect(readAfter.admin_role_id).toBe('role-nuevo');
  });
});
