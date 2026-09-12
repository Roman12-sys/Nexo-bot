import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createSupabaseMock } from './helpers/supabaseMock.js';

// PERF-1 (plan de ejecución post-auditoría, 2026-09-12) — getGuildWarns() traía CADA
// fila de warnings del server entero (motivo/moderador/fecha de toda advertencia
// jamás dada) solo para reducirla a un conteo por usuario en el panel /sanciones.
// getGuildWarnCounts hace ese conteo en Postgres (RPC get_guild_warn_counts, mismo
// patrón que top_guild_achievers de economyStore.js) — primera cobertura de este
// archivo, no existía ningún test de warnsStore.js hasta ahora.
const supabaseMock = createSupabaseMock();
vi.mock('../src/supabaseClient.js', () => ({ get supabase() { return supabaseMock; } }));

const { getGuildWarnCounts } = await import('../src/utils/warnsStore.js');

beforeEach(() => {
  vi.clearAllMocks();
  supabaseMock.rpc.mockReset();
});

describe('getGuildWarnCounts', () => {
  it('llama al RPC con guild_id y el límite pedido, mapea user_id/warn_count/total real', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        { user_id: 'user-1', warn_count: 5, total_users: 2 },
        { user_id: 'user-2', warn_count: 1, total_users: 2 },
      ],
      error: null,
    });

    const result = await getGuildWarnCounts('guild-1', 25);

    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_guild_warn_counts', { p_guild_id: 'guild-1', p_limit: 25 });
    expect(result).toEqual({
      rows: [{ userId: 'user-1', warnCount: 5 }, { userId: 'user-2', warnCount: 1 }],
      total: 2,
    });
  });

  it('nadie con advertencias: total 0, array vacío, no revienta', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: [], error: null });

    const result = await getGuildWarnCounts('guild-vacio', 25);

    expect(result).toEqual({ rows: [], total: 0 });
  });

  it('límite por defecto es 25 si no se especifica', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: [], error: null });

    await getGuildWarnCounts('guild-1');

    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_guild_warn_counts', { p_guild_id: 'guild-1', p_limit: 25 });
  });

  it('un error del RPC se propaga sin manejar acá', async () => {
    const dbError = new Error('función no existe todavía');
    supabaseMock.rpc.mockResolvedValue({ data: null, error: dbError });

    await expect(getGuildWarnCounts('guild-1')).rejects.toBe(dbError);
  });

  it('dos guilds distintos: cada llamada manda su propio guild_id, nunca comparten resultado', async () => {
    supabaseMock.rpc
      .mockResolvedValueOnce({ data: [{ user_id: 'user-a', warn_count: 1, total_users: 1 }], error: null })
      .mockResolvedValueOnce({ data: [{ user_id: 'user-b', warn_count: 9, total_users: 1 }], error: null });

    const resultA = await getGuildWarnCounts('guild-a');
    const resultB = await getGuildWarnCounts('guild-b');

    expect(supabaseMock.rpc).toHaveBeenNthCalledWith(1, 'get_guild_warn_counts', { p_guild_id: 'guild-a', p_limit: 25 });
    expect(supabaseMock.rpc).toHaveBeenNthCalledWith(2, 'get_guild_warn_counts', { p_guild_id: 'guild-b', p_limit: 25 });
    expect(resultA.rows[0].userId).toBe('user-a');
    expect(resultB.rows[0].userId).toBe('user-b');
  });
});
