import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createSupabaseMock } from './helpers/supabaseMock.js';

// Auditoría 2026-08-27: antes de este handler, sacar al bot de un server no borraba
// NADA — guild_config y las 19 tablas por-guild quedaban huérfanas para siempre. Lo que
// importa acá es que se intente borrar de TODAS las tablas esperadas (ni una tabla de
// más que reminders/lol_patch_state, ni una de menos) y que una tabla fallando no frene
// la limpieza de las demás.
const supabaseMock = createSupabaseMock();
vi.mock('../src/supabaseClient.js', () => ({ get supabase() { return supabaseMock; } }));

const { execute } = await import('../src/events/guildDelete.js');

function makeGuild(id = 'guild-1') {
  return { id, name: 'Servidor de prueba' };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('guildDelete', () => {
  it('borra por guild_id en guild_config y en las tablas por-guild', async () => {
    await execute(makeGuild('guild-1'));

    expect(supabaseMock.from).toHaveBeenCalledWith('guild_config');
    expect(supabaseMock.from).toHaveBeenCalledWith('economy');
    expect(supabaseMock.from).toHaveBeenCalledWith('economy_transactions');
    expect(supabaseMock.from).toHaveBeenCalledWith('xp');
    expect(supabaseMock.from).toHaveBeenCalledWith('warnings');
    expect(supabaseMock.from).toHaveBeenCalledWith('giveaways');
    expect(supabaseMock.from).toHaveBeenCalledWith('pets');

    expect(supabaseMock.getBuilder('guild_config').delete).toHaveBeenCalled();
    expect(supabaseMock.getBuilder('guild_config').eq).toHaveBeenCalledWith('guild_id', 'guild-1');
  });

  it('nunca toca reminders (DM-based, guild_id es solo referencia) ni lol_patch_state (sin guild_id)', async () => {
    await execute(makeGuild('guild-1'));

    expect(supabaseMock.from).not.toHaveBeenCalledWith('reminders');
    expect(supabaseMock.from).not.toHaveBeenCalledWith('lol_patch_state');
  });

  it('si una tabla falla, las demás igual se intentan borrar (no corta en la primera)', async () => {
    supabaseMock.getBuilder('economy').__setResult({ data: null, error: { message: 'boom' } });

    await expect(execute(makeGuild('guild-1'))).resolves.not.toThrow();

    // A pesar del fallo en "economy", el resto de las tablas se intentaron igual.
    expect(supabaseMock.from).toHaveBeenCalledWith('pets');
    expect(supabaseMock.from).toHaveBeenCalledWith('command_usage');
  });
});
