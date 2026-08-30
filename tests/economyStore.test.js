import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSupabaseMock } from './helpers/supabaseMock.js';
import { eventBus } from '../src/utils/eventBus.js';

// economyStore.js hace toda la escritura de dinero vía RPCs atómicas de Postgres
// (increment_balance, deduct_balance_if_sufficient, transfer_balance) — la atomicidad en
// sí es responsabilidad de Postgres y no se puede probar con un mock. Lo que SÍ se puede
// (y debe) probar acá es la lógica del lado JS: qué parámetros le mandamos al RPC, cómo
// mapeamos su resultado, y cómo traducimos sus errores a algo que los comandos puedan
// distinguir (ver el .code === 'insufficient_funds' que usan /buy y /pagar).
const supabaseMock = createSupabaseMock();
vi.mock('../src/supabaseClient.js', () => ({ get supabase() { return supabaseMock; } }));

const { addBalance, deductBalanceIfSufficient, transferBalance, setBalance, setRobCooldowns, recordTransaction } = await import('../src/utils/economyStore.js');

beforeEach(() => {
  // clearAllMocks limpia el historial de llamadas de TODOS los vi.fn() vivos —
  // incluye los métodos encadenables de los builders, que se crean una sola vez por
  // tabla y se reusan entre tests (ver createSupabaseMock). rpc.mockReset() además
  // borra el mockResolvedValue que haya quedado seteado del test anterior.
  vi.clearAllMocks();
  supabaseMock.rpc.mockReset();
  supabaseMock.getBuilder('economy').__setResult({ data: null, error: null });
  supabaseMock.getBuilder('economy_transactions').__setResult({ data: null, error: null });
});

describe('addBalance', () => {
  it('llama a increment_balance con guildId/userId/amount y devuelve el balance nuevo', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: 250, error: null });

    const result = await addBalance('guild-1', 'user-1', 100);

    expect(supabaseMock.rpc).toHaveBeenCalledWith('increment_balance', {
      p_guild_id: 'guild-1',
      p_user_id: 'user-1',
      p_amount: 100,
    });
    expect(result).toBe(250);
  });

  it('con meta, registra una transacción con el balance resultante', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: 250, error: null });
    const insert = supabaseMock.getBuilder('economy_transactions').insert;

    await addBalance('guild-1', 'user-1', 100, { type: 'daily' });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'daily', amount: 100, balance_after: 250 }),
    );
  });

  it('sin meta, no toca la tabla de transacciones', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: 250, error: null });
    const insert = supabaseMock.getBuilder('economy_transactions').insert;

    await addBalance('guild-1', 'user-1', 100);

    expect(insert).not.toHaveBeenCalled();
  });
});

describe('deductBalanceIfSufficient', () => {
  it('si el RPC rechaza por fondos insuficientes, el error queda marcado con .code', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: { message: 'insufficient_funds' } });

    await expect(deductBalanceIfSufficient('guild-1', 'user-1', 500)).rejects.toMatchObject({
      code: 'insufficient_funds',
    });
  });

  it('otros errores del RPC se propagan tal cual, sin marcar .code', async () => {
    const dbError = { message: 'connection refused' };
    supabaseMock.rpc.mockResolvedValue({ data: null, error: dbError });

    await expect(deductBalanceIfSufficient('guild-1', 'user-1', 500)).rejects.toBe(dbError);
  });
});

describe('transferBalance', () => {
  it('mapea el resultado del RPC (array, como devuelve Postgres) a camelCase', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [{ sender_balance: 100, receiver_balance: 400 }],
      error: null,
    });

    const result = await transferBalance('guild-1', 'sender-1', 'receiver-1', 50);

    expect(result).toEqual({ senderBalance: 100, receiverBalance: 400 });
  });

  it('también mapea el resultado si Postgres lo devuelve como objeto suelto', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { sender_balance: 100, receiver_balance: 400 },
      error: null,
    });

    const result = await transferBalance('guild-1', 'sender-1', 'receiver-1', 50);

    expect(result).toEqual({ senderBalance: 100, receiverBalance: 400 });
  });

  it('fondos insuficientes en la transferencia también quedan marcados con .code', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: { message: 'insufficient_funds' } });

    await expect(transferBalance('guild-1', 'sender-1', 'receiver-1', 999)).rejects.toMatchObject({
      code: 'insufficient_funds',
    });
  });
});

describe('setRobCooldowns', () => {
  // Auditoría 2026-08-27: antes eran dos UPDATE independientes vía Promise.all() —
  // si el segundo fallaba después de que el primero ya había commiteado, el robber
  // quedaba con cooldown pero la víctima sin protección. Ahora es una sola RPC
  // (set_rob_cooldowns) que corre los dos UPDATE en una única transacción de Postgres.
  it('llama a la RPC set_rob_cooldowns con los 4 valores esperados', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: null });

    await setRobCooldowns('guild-1', {
      robberId: 'robber-1',
      robberTimestamp: 1000,
      victimId: 'victim-1',
      victimTimestamp: 2000,
    });

    expect(supabaseMock.rpc).toHaveBeenCalledWith('set_rob_cooldowns', {
      p_guild_id: 'guild-1',
      p_robber_id: 'robber-1',
      p_robber_ts: 1000,
      p_victim_id: 'victim-1',
      p_victim_ts: 2000,
    });
  });

  it('si la RPC falla, el error se propaga (nunca queda a medio aplicar)', async () => {
    const dbError = { message: 'connection refused' };
    supabaseMock.rpc.mockResolvedValue({ data: null, error: dbError });

    await expect(
      setRobCooldowns('guild-1', { robberId: 'r', robberTimestamp: 1, victimId: 'v', victimTimestamp: 2 }),
    ).rejects.toBe(dbError);
  });
});

describe('setBalance', () => {
  it('un monto negativo se clampea a 0, nunca queda un balance negativo guardado', async () => {
    supabaseMock.getBuilder('economy').__setResult({ data: { balance: 0, last_daily: 0, last_work: 0, inventory: {} }, error: null });
    const upsert = supabaseMock.getBuilder('economy').upsert;

    const result = await setBalance('guild-1', 'user-1', -50);

    expect(result).toBe(0);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ balance: 0 }),
      expect.anything(),
    );
  });
});

// Fase A, segunda auditoría 2026-08-30 — el Event Engine ya no debe bloquear la
// operación de dominio, y COINS_EARNED/COINS_DESTROYED tienen que clasificar el origen
// correctamente (ver src/utils/economyOrigins.js). afterEach restaura los spies de
// eventBus para no filtrar mocks entre describes de este mismo archivo.
describe('addBalance — Event Engine (Fase A)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emite COINS_EARNED con guildId/userId/amount/type/origin cuando amount > 0', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: 250, error: null });
    const emitSpy = vi.spyOn(eventBus, 'emit').mockResolvedValue(undefined);

    await addBalance('guild-1', 'user-1', 100, { type: 'daily' });

    expect(emitSpy).toHaveBeenCalledWith('COINS_EARNED', {
      guildId: 'guild-1',
      userId: 'user-1',
      amount: 100,
      netAmount: 100,
      type: 'daily',
      origin: 'activity',
    });
  });

  it('no emite COINS_EARNED cuando amount <= 0', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: 0, error: null });
    const emitSpy = vi.spyOn(eventBus, 'emit').mockResolvedValue(undefined);

    await addBalance('guild-1', 'user-1', -50, { type: 'admin_remove' });

    expect(emitSpy).not.toHaveBeenCalledWith('COINS_EARNED', expect.anything());
  });

  it('admin_add se clasifica con origin "admin" (no es actividad orgánica)', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: 5000, error: null });
    const emitSpy = vi.spyOn(eventBus, 'emit').mockResolvedValue(undefined);

    await addBalance('guild-1', 'user-1', 5000, { type: 'admin_add' });

    expect(emitSpy).toHaveBeenCalledWith('COINS_EARNED', expect.objectContaining({ origin: 'admin' }));
  });

  it('gamble_win usa netGain como netAmount, sin tocar el amount bruto que se acredita', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: 2000, error: null });
    const emitSpy = vi.spyOn(eventBus, 'emit').mockResolvedValue(undefined);

    const finalBalance = await addBalance('guild-1', 'user-1', 2000, { type: 'gamble_win', netGain: 1000 });

    expect(finalBalance).toBe(2000); // el balance se acredita completo (payout bruto)
    expect(emitSpy).toHaveBeenCalledWith('COINS_EARNED', expect.objectContaining({ amount: 2000, netAmount: 1000, origin: 'stake' }));
  });

  it('no espera a que termine el emit antes de devolver el balance nuevo', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: 100, error: null });
    let emitSettled = false;
    vi.spyOn(eventBus, 'emit').mockImplementation(
      () => new Promise((resolve) => {
        setTimeout(() => {
          emitSettled = true;
          resolve();
        }, 50);
      }),
    );

    const newBalance = await addBalance('guild-1', 'user-1', 100, { type: 'daily' });

    expect(newBalance).toBe(100);
    // Si addBalance todavía hiciera `await eventBus.emit(...)`, esta línea no se
    // alcanzaría hasta pasados los 50ms del timer de arriba.
    expect(emitSettled).toBe(false);
  });
});

describe('recordTransaction — COINS_DESTROYED (Fase A)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('crime_fine (monto negativo) emite COINS_DESTROYED con el monto absoluto', async () => {
    const emitSpy = vi.spyOn(eventBus, 'emit').mockResolvedValue(undefined);

    await recordTransaction('guild-1', 'user-1', { type: 'crime_fine', amount: -80, balanceAfter: 20 });

    expect(emitSpy).toHaveBeenCalledWith('COINS_DESTROYED', { guildId: 'guild-1', userId: 'user-1', amount: 80, type: 'crime_fine' });
  });

  it('purchase (monto negativo) también emite COINS_DESTROYED', async () => {
    const emitSpy = vi.spyOn(eventBus, 'emit').mockResolvedValue(undefined);

    await recordTransaction('guild-1', 'user-1', { type: 'purchase', amount: -250, balanceAfter: 0 });

    expect(emitSpy).toHaveBeenCalledWith('COINS_DESTROYED', { guildId: 'guild-1', userId: 'user-1', amount: 250, type: 'purchase' });
  });

  it('un tipo no destructivo (bank_deposit) no emite COINS_DESTROYED', async () => {
    const emitSpy = vi.spyOn(eventBus, 'emit').mockResolvedValue(undefined);

    await recordTransaction('guild-1', 'user-1', { type: 'bank_deposit', amount: -100, balanceAfter: 0 });

    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('rob_fine (transferencia a la víctima, no destrucción) tampoco emite COINS_DESTROYED', async () => {
    const emitSpy = vi.spyOn(eventBus, 'emit').mockResolvedValue(undefined);

    await recordTransaction('guild-1', 'user-1', { type: 'rob_fine', amount: -30, balanceAfter: 70 });

    expect(emitSpy).not.toHaveBeenCalled();
  });
});
