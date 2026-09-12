import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createSupabaseMock, createQueryBuilder } from './helpers/supabaseMock.js';

// Observabilidad de negocio (plan de ejecución post-auditoría, Fase 5, 2026-09-12) —
// primera cobertura de este archivo. getGuildEventCounts hace 2 queries reales (join +
// leave) al mismo tiempo (Promise.all) sobre la MISMA tabla — se simulan con dos
// mockImplementationOnce consecutivas (el builder compartido de createSupabaseMock() no
// distingue entre llamadas a la misma tabla), mismo patrón que economyStore.test.js
// (getGuildEconomyPage).
const supabaseMock = createSupabaseMock();
vi.mock('../src/supabaseClient.js', () => ({ get supabase() { return supabaseMock; } }));

const { recordGuildEvent, getGuildEventCounts } = await import('../src/utils/botGuildEventsStore.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('recordGuildEvent', () => {
  it('inserta guild_id + event_type', async () => {
    supabaseMock.getBuilder('bot_guild_events').__setResult({ data: null, error: null });

    await recordGuildEvent('guild-1', 'join');

    expect(supabaseMock.getBuilder('bot_guild_events').insert).toHaveBeenCalledWith({ guild_id: 'guild-1', event_type: 'join' });
  });

  it('un error de Postgres se loguea, nunca se propaga (best-effort)', async () => {
    supabaseMock.getBuilder('bot_guild_events').__setResult({ data: null, error: new Error('boom') });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(recordGuildEvent('guild-1', 'leave')).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe('getGuildEventCounts', () => {
  it('cuenta joins y leaves por separado desde la fecha pedida', async () => {
    supabaseMock.from
      .mockImplementationOnce(() => createQueryBuilder({ count: 5, error: null })) // joins
      .mockImplementationOnce(() => createQueryBuilder({ count: 2, error: null })); // leaves

    const result = await getGuildEventCounts(Date.now() - 7 * 24 * 60 * 60 * 1000);

    expect(result).toEqual({ joins: 5, leaves: 2 });
  });

  it('sin eventos en la ventana: 0/0, no null/undefined', async () => {
    supabaseMock.from
      .mockImplementationOnce(() => createQueryBuilder({ count: 0, error: null }))
      .mockImplementationOnce(() => createQueryBuilder({ count: 0, error: null }));

    const result = await getGuildEventCounts(Date.now());

    expect(result).toEqual({ joins: 0, leaves: 0 });
  });

  it('un error en la query de joins se propaga', async () => {
    const dbError = new Error('timeout');
    supabaseMock.from
      .mockImplementationOnce(() => createQueryBuilder({ count: null, error: dbError }))
      .mockImplementationOnce(() => createQueryBuilder({ count: 0, error: null }));

    await expect(getGuildEventCounts(Date.now())).rejects.toBe(dbError);
  });

  it('un error en la query de leaves se propaga', async () => {
    const dbError = new Error('timeout');
    supabaseMock.from
      .mockImplementationOnce(() => createQueryBuilder({ count: 3, error: null }))
      .mockImplementationOnce(() => createQueryBuilder({ count: null, error: dbError }));

    await expect(getGuildEventCounts(Date.now())).rejects.toBe(dbError);
  });
});
