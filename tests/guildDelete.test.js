import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createSupabaseMock } from './helpers/supabaseMock.js';

// Auditoría 2026-08-27 (ampliada Fase 2A, 2026-08-31): antes de este handler, sacar al
// bot de un server no borraba NADA — guild_config y el resto de las tablas por-guild
// quedaban huérfanas para siempre. Lo que importa acá es que se intente borrar de TODAS
// las tablas guild-scoped reales (comparadas contra GUILD_SCOPED_TABLES, la fuente
// única de verdad exportada por el propio módulo — no una lista copiada a mano en el
// test, que se desactualiza sola cada vez que se agrega una tabla nueva), que ni
// reminders ni las tablas de una sola fija (lol_patch_state/spotify_auth) se toquen, y
// que un guild nunca vea afectados los datos de otro.
const supabaseMock = createSupabaseMock();
vi.mock('../src/supabaseClient.js', () => ({ get supabase() { return supabaseMock; } }));

const invalidateGuildConfig = vi.fn();
vi.mock('../src/utils/guildConfigStore.js', () => ({ invalidateGuildConfig }));

const { execute, GUILD_SCOPED_TABLES } = await import('../src/events/guildDelete.js');

function makeGuild(id = 'guild-1') {
  return { id, name: 'Servidor de prueba' };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('guildDelete', () => {
  it('borra por guild_id en TODAS las tablas de GUILD_SCOPED_TABLES, ni una de menos', async () => {
    await execute(makeGuild('guild-1'));

    for (const table of GUILD_SCOPED_TABLES) {
      expect(supabaseMock.from).toHaveBeenCalledWith(table);
      expect(supabaseMock.getBuilder(table).delete).toHaveBeenCalled();
      expect(supabaseMock.getBuilder(table).eq).toHaveBeenCalledWith('guild_id', 'guild-1');
    }
  });

  it('incluye las 3 tablas agregadas en Fase 2A que faltaban (active_punishments, user_missions, guild_daily_stats)', () => {
    expect(GUILD_SCOPED_TABLES).toEqual(
      expect.arrayContaining(['active_punishments', 'user_missions', 'guild_daily_stats']),
    );
  });

  it('nunca toca reminders (DM-based) ni las tablas de fila fija (lol_patch_state, spotify_auth)', async () => {
    await execute(makeGuild('guild-1'));

    expect(supabaseMock.from).not.toHaveBeenCalledWith('reminders');
    expect(supabaseMock.from).not.toHaveBeenCalledWith('lol_patch_state');
    expect(supabaseMock.from).not.toHaveBeenCalledWith('spotify_auth');
  });

  it('invalida el cache de guild_config del guild que se fue', async () => {
    await execute(makeGuild('guild-1'));

    expect(invalidateGuildConfig).toHaveBeenCalledWith('guild-1');
  });

  it('si una tabla falla, las demás igual se intentan borrar (no corta en la primera)', async () => {
    supabaseMock.getBuilder('economy').__setResult({ data: null, error: { message: 'boom' } });

    await expect(execute(makeGuild('guild-1'))).resolves.not.toThrow();

    // A pesar del fallo en "economy", el resto de las tablas se intentaron igual.
    expect(supabaseMock.from).toHaveBeenCalledWith('announcement_templates');
    expect(supabaseMock.from).toHaveBeenCalledWith('command_usage');
    expect(supabaseMock.from).toHaveBeenCalledWith('guild_daily_stats');
    // El cache igual se invalida — un fallo parcial de borrado no debe dejar la config
    // vieja cacheada.
    expect(invalidateGuildConfig).toHaveBeenCalledWith('guild-1');
  });

  it('es idempotente: correrlo dos veces seguidas para el mismo guild no falla', async () => {
    await execute(makeGuild('guild-1'));
    await expect(execute(makeGuild('guild-1'))).resolves.not.toThrow();

    expect(invalidateGuildConfig).toHaveBeenCalledTimes(2);
  });

  it('dos guilds: borrar el guild A nunca toca los filtros del guild B', async () => {
    await execute(makeGuild('guild-a'));

    for (const table of GUILD_SCOPED_TABLES) {
      expect(supabaseMock.getBuilder(table).eq).toHaveBeenCalledWith('guild_id', 'guild-a');
      expect(supabaseMock.getBuilder(table).eq).not.toHaveBeenCalledWith('guild_id', 'guild-b');
    }
    expect(invalidateGuildConfig).toHaveBeenCalledWith('guild-a');
    expect(invalidateGuildConfig).not.toHaveBeenCalledWith('guild-b');
  });
});
