import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSupabaseMock } from './helpers/supabaseMock.js';

// missionsStore.js es infraestructura nueva (Fase 3) que Fase A (segunda auditoría,
// 2026-08-30) corrigió sin tests propios hasta ahora. addBalance/addXp se mockean acá
// (no se usa el economyStore/xpStore real) para aislar exactamente lo que este archivo
// decide: qué origen cuenta para el progreso, cuánto upsert redundante hace, y que una
// misión ya completa no vuelve a pagar. La cascada real COINS_EARNED->addBalance
// (economyStore.js) ya está probada en economyStore.test.js — repetirla acá solo
// acoplaría este archivo a esa implementación sin proteger nada nuevo.
const addBalance = vi.fn().mockResolvedValue(0);
vi.mock('../src/utils/economyStore.js', () => ({ addBalance }));

const addXp = vi.fn().mockResolvedValue({});
vi.mock('../src/utils/xpStore.js', () => ({ addXp }));

const supabaseMock = createSupabaseMock();
vi.mock('../src/supabaseClient.js', () => ({ get supabase() { return supabaseMock; } }));

// Importar el módulo registra sus 4 handlers en el eventBus REAL como side-effect —
// mismo patrón que usa el bot en producción (ready.js solo importa el archivo).
await import('../src/utils/missionsStore.js');
const { eventBus } = await import('../src/utils/eventBus.js');

function mockRpcJustCompleted(byMissionId = {}) {
  supabaseMock.rpc.mockImplementation((name, params) => {
    if (name !== 'increment_mission_progress') return Promise.resolve({ data: null, error: null });
    const justCompleted = byMissionId[params.p_mission_id] ?? false;
    return Promise.resolve({
      data: [{ progress: 1, target: 1, just_completed: justCompleted, reward_coins: 10, reward_xp: 5 }],
      error: null,
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseMock.getBuilder('user_missions').__setResult({ data: null, error: null });
  mockRpcJustCompleted();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('COINS_EARNED — filtro de origen (Fase A)', () => {
  it('origin "activity" hace avanzar daily_earn y weekly_earn con el monto completo', async () => {
    await eventBus.emit('COINS_EARNED', { guildId: 'g1', userId: 'u-activity', amount: 200, origin: 'activity' });

    const calls = supabaseMock.rpc.mock.calls.filter(([name]) => name === 'increment_mission_progress');
    const missionIds = calls.map(([, params]) => params.p_mission_id);
    expect(missionIds).toEqual(expect.arrayContaining(['daily_earn', 'weekly_earn']));
    for (const [, params] of calls) {
      expect(params.p_amount).toBe(200);
    }
  });

  it('origin "admin" no hace avanzar ninguna misión (ajuste de staff, no actividad)', async () => {
    await eventBus.emit('COINS_EARNED', { guildId: 'g1', userId: 'u-admin', amount: 5000, origin: 'admin' });

    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(supabaseMock.getBuilder('user_missions').upsert).not.toHaveBeenCalled();
  });

  it('origin "reward" no hace avanzar ninguna misión (corta la cadena COINS_EARNED→misión→recompensa→COINS_EARNED)', async () => {
    await eventBus.emit('COINS_EARNED', { guildId: 'g1', userId: 'u-reward', amount: 60, type: 'mission', origin: 'reward' });

    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('origin "stake" usa netAmount (ganancia neta), nunca el payout bruto', async () => {
    await eventBus.emit('COINS_EARNED', { guildId: 'g1', userId: 'u-stake', amount: 2000, netAmount: 1000, origin: 'stake' });

    const calls = supabaseMock.rpc.mock.calls.filter(([name]) => name === 'increment_mission_progress');
    expect(calls.length).toBeGreaterThan(0);
    for (const [, params] of calls) {
      expect(params.p_amount).toBe(1000);
    }
  });

  it('origin "stake" con ganancia neta <= 0 no hace avanzar ninguna misión', async () => {
    await eventBus.emit('COINS_EARNED', { guildId: 'g1', userId: 'u-stake-loss', amount: 500, netAmount: -200, origin: 'stake' });

    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });
});

describe('XP_GAINED — daily_messages / daily_voice', () => {
  it('source "message" incrementa daily_messages, no daily_voice', async () => {
    await eventBus.emit('XP_GAINED', { guildId: 'g1', userId: 'u-msg', amount: 20, source: 'message' });

    const missionIds = supabaseMock.rpc.mock.calls.filter(([name]) => name === 'increment_mission_progress').map(([, p]) => p.p_mission_id);
    expect(missionIds).toEqual(['daily_messages']);
  });

  it('source "voice" incrementa daily_voice, no daily_messages', async () => {
    await eventBus.emit('XP_GAINED', { guildId: 'g1', userId: 'u-voice', amount: 15, source: 'voice' });

    const missionIds = supabaseMock.rpc.mock.calls.filter(([name]) => name === 'increment_mission_progress').map(([, p]) => p.p_mission_id);
    expect(missionIds).toEqual(['daily_voice']);
  });

  it('source "admin" (XP de staff) no incrementa ninguna de las dos', async () => {
    await eventBus.emit('XP_GAINED', { guildId: 'g1', userId: 'u-xpadmin', amount: 500, source: 'admin' });

    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });
});

describe('Pago de recompensa — una sola vez', () => {
  it('paga la recompensa solo cuando la RPC confirma just_completed, no en llamadas posteriores', async () => {
    mockRpcJustCompleted({ daily_trivia: true });

    await eventBus.emit('TRIVIA_CORRECT', { guildId: 'g1', userId: 'u-trivia' });
    expect(addBalance).toHaveBeenCalledTimes(1);
    expect(addBalance).toHaveBeenCalledWith('g1', 'u-trivia', 10, expect.objectContaining({ type: 'mission' }));
    expect(addXp).toHaveBeenCalledTimes(1);

    // Segunda vez: la misión ya está completa, la RPC ya no devuelve just_completed.
    mockRpcJustCompleted({ daily_trivia: false });
    await eventBus.emit('TRIVIA_CORRECT', { guildId: 'g1', userId: 'u-trivia' });

    expect(addBalance).toHaveBeenCalledTimes(1); // sigue en 1, no se pagó de nuevo
    expect(addXp).toHaveBeenCalledTimes(1);
  });
});

describe('ensureCurrentMissions — sin upsert redundante (Fase A)', () => {
  it('dos eventos del mismo usuario en el mismo período solo upsertean el catálogo una vez', async () => {
    await eventBus.emit('XP_GAINED', { guildId: 'g1', userId: 'u-cache', amount: 20, source: 'message' });
    await eventBus.emit('XP_GAINED', { guildId: 'g1', userId: 'u-cache', amount: 20, source: 'message' });

    expect(supabaseMock.getBuilder('user_missions').upsert).toHaveBeenCalledTimes(1);
  });

  it('usuarios distintos sí upsertean cada uno el suyo', async () => {
    await eventBus.emit('XP_GAINED', { guildId: 'g1', userId: 'u-cache-a', amount: 20, source: 'message' });
    await eventBus.emit('XP_GAINED', { guildId: 'g1', userId: 'u-cache-b', amount: 20, source: 'message' });

    expect(supabaseMock.getBuilder('user_missions').upsert).toHaveBeenCalledTimes(2);
  });

  // Multi-guild (Fase 2A, 2026-08-31) — la cache está keyeada por `${guildId}:${userId}`
  // (missionsStore.js), no solo por userId. El MISMO usuario activo en dos servidores
  // donde el bot está es el caso real que puede pasar en producción: si la cache
  // ignorara guildId, el segundo guild se saltearía su propio upsert pensando que ya
  // estaba asegurado (lo aseguró el primero).
  it('el MISMO usuario en dos guilds distintos: cada guild upsertea su propia fila de misiones, ninguno se salta', async () => {
    await eventBus.emit('XP_GAINED', { guildId: 'guild-a', userId: 'user-123', amount: 20, source: 'message' });
    await eventBus.emit('XP_GAINED', { guildId: 'guild-b', userId: 'user-123', amount: 20, source: 'message' });

    expect(supabaseMock.getBuilder('user_missions').upsert).toHaveBeenCalledTimes(2);
  });

  it('el MISMO usuario en dos guilds: el progreso de misión de cada guild se manda con su propio p_guild_id', async () => {
    await eventBus.emit('XP_GAINED', { guildId: 'guild-a', userId: 'user-123', amount: 20, source: 'message' });
    await eventBus.emit('XP_GAINED', { guildId: 'guild-b', userId: 'user-123', amount: 20, source: 'message' });

    const calls = supabaseMock.rpc.mock.calls.filter(([name]) => name === 'increment_mission_progress');
    const guildIds = calls.map(([, params]) => params.p_guild_id);
    expect(guildIds).toEqual(expect.arrayContaining(['guild-a', 'guild-b']));
  });
});
