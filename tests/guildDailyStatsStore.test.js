import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createSupabaseMock } from './helpers/supabaseMock.js';

// guildDailyStatsStore.js alimenta guild_daily_stats (dashboard) en vivo desde el Event
// Engine — Fase A (segunda auditoría, 2026-08-30) le agregó el filtro por `origin` que
// faltaba (money_created/xp_distributed contaban cualquier monto positivo, incluidos
// ajustes de staff y el payout bruto de casino) y la columna nueva money_destroyed.
// Ninguno de estos handlers tenía test antes de esta fase.
const supabaseMock = createSupabaseMock();
vi.mock('../src/supabaseClient.js', () => ({ get supabase() { return supabaseMock; } }));

await import('../src/utils/guildDailyStatsStore.js');
const { eventBus } = await import('../src/utils/eventBus.js');

function rpcCallsFor(name) {
  return supabaseMock.rpc.mock.calls.filter(([rpcName]) => rpcName === name);
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseMock.rpc.mockResolvedValue({ data: null, error: null });
});

describe('COINS_EARNED — money_created', () => {
  it('origin "admin" no incrementa money_created (ajuste de staff, no plata creada por el sistema)', async () => {
    await eventBus.emit('COINS_EARNED', { guildId: 'g1', amount: 5000, origin: 'admin' });

    expect(rpcCallsFor('increment_guild_daily_stat')).toHaveLength(0);
  });

  it('origin "stake" suma netAmount, no el payout bruto', async () => {
    await eventBus.emit('COINS_EARNED', { guildId: 'g1', amount: 2000, netAmount: 800, origin: 'stake' });

    const [, params] = rpcCallsFor('increment_guild_daily_stat')[0];
    expect(params.p_money).toBe(800);
  });

  it('origin "reward" (recompensa de misión) sí cuenta — es plata nueva real, a diferencia de missionsStore', async () => {
    await eventBus.emit('COINS_EARNED', { guildId: 'g1', amount: 60, origin: 'reward' });

    const [, params] = rpcCallsFor('increment_guild_daily_stat')[0];
    expect(params.p_money).toBe(60);
  });

  it('origin "activity" cuenta el monto completo, como siempre', async () => {
    await eventBus.emit('COINS_EARNED', { guildId: 'g1', amount: 150, origin: 'activity' });

    const [, params] = rpcCallsFor('increment_guild_daily_stat')[0];
    expect(params.p_money).toBe(150);
  });
});

describe('XP_GAINED — xp_distributed', () => {
  it('origin "admin" (/xp de staff) no incrementa xp_distributed', async () => {
    await eventBus.emit('XP_GAINED', { guildId: 'g1', amount: 500, origin: 'admin' });

    expect(rpcCallsFor('increment_guild_daily_stat')).toHaveLength(0);
  });

  it('origin "activity" incrementa xp_distributed con el monto', async () => {
    await eventBus.emit('XP_GAINED', { guildId: 'g1', amount: 20, origin: 'activity' });

    const [, params] = rpcCallsFor('increment_guild_daily_stat')[0];
    expect(params.p_xp).toBe(20);
  });
});

describe('COINS_DESTROYED — money_destroyed (Fase A, nuevo)', () => {
  it('incrementa money_destroyed con el monto recibido', async () => {
    await eventBus.emit('COINS_DESTROYED', { guildId: 'g1', amount: 80, type: 'crime_fine' });

    const [, params] = rpcCallsFor('increment_guild_daily_stat')[0];
    expect(params.p_money_destroyed).toBe(80);
  });
});

describe('métricas de actividad', () => {
  it('MESSAGE_SENT incrementa p_messages', async () => {
    await eventBus.emit('MESSAGE_SENT', { guildId: 'g1' });
    expect(rpcCallsFor('increment_guild_daily_stat')[0][1].p_messages).toBe(1);
  });

  it('MEMBER_JOINED incrementa p_new_members', async () => {
    await eventBus.emit('MEMBER_JOINED', { guildId: 'g1' });
    expect(rpcCallsFor('increment_guild_daily_stat')[0][1].p_new_members).toBe(1);
  });

  it('COMMAND_EXECUTED incrementa p_commands', async () => {
    await eventBus.emit('COMMAND_EXECUTED', { guildId: 'g1', commandName: 'ping' });
    expect(rpcCallsFor('increment_guild_daily_stat')[0][1].p_commands).toBe(1);
  });

  it('COMMAND_EXECUTED sin guildId (ej. autocomplete en DM) no llama al RPC', async () => {
    await eventBus.emit('COMMAND_EXECUTED', { guildId: null, commandName: 'ping' });
    expect(rpcCallsFor('increment_guild_daily_stat')).toHaveLength(0);
  });
});
