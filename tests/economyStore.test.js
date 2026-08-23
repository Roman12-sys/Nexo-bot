import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createSupabaseMock } from './helpers/supabaseMock.js';

// economyStore.js hace toda la escritura de dinero vía RPCs atómicas de Postgres
// (increment_balance, deduct_balance_if_sufficient, transfer_balance) — la atomicidad en
// sí es responsabilidad de Postgres y no se puede probar con un mock. Lo que SÍ se puede
// (y debe) probar acá es la lógica del lado JS: qué parámetros le mandamos al RPC, cómo
// mapeamos su resultado, y cómo traducimos sus errores a algo que los comandos puedan
// distinguir (ver el .code === 'insufficient_funds' que usan /buy y /pagar).
const supabaseMock = createSupabaseMock();
vi.mock('../src/supabaseClient.js', () => ({ get supabase() { return supabaseMock; } }));

const { addBalance, deductBalanceIfSufficient, transferBalance, setBalance } = await import('../src/utils/economyStore.js');

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
