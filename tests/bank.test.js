import { vi, describe, it, expect, beforeEach } from 'vitest';

// Auditoría completa NEXO (2026-09-11): /bank es el único comando de economía que
// además de mover plata calcula interés con reset de reloj — y ya rompió en producción
// una vez (ver CLAUDE.md: depositar mucho después de vaciar la cuenta cobraba interés
// de un período en que el banco estuvo en 0). Pese a eso, nunca tuvo un test propio, ni
// de la lógica básica ni del lock `bank:{guild}:{user}` que comparten depositar/
// retirar/ver. El mock de depositToBank/withdrawFromBank simula un round-trip real
// (await entre leer el balance y escribirlo) para que una carrera de verdad sea posible
// si el lock desaparece — sin ese await, dos llamadas nunca se intercalarían en Node
// sin importar si hay lock o no, y el test no probaría nada.
let state;

function makeInsufficientError() {
  const e = new Error('insufficient_funds');
  e.code = 'insufficient_funds';
  return e;
}

const getUserEconomy = vi.fn(async () => ({ ...state }));
const depositToBank = vi.fn(async (guildId, userId, amount) => {
  const currentBalance = state.balance;
  await new Promise((r) => setTimeout(r, 10)); // simula el round-trip real a Postgres
  if (amount > currentBalance) throw makeInsufficientError();
  state.balance = currentBalance - amount;
  state.bank += amount;
  return { wallet: state.balance, bank: state.bank };
});
const withdrawFromBank = vi.fn(async (guildId, userId, amount) => {
  const currentBank = state.bank;
  await new Promise((r) => setTimeout(r, 10));
  if (amount > currentBank) throw makeInsufficientError();
  state.bank = currentBank - amount;
  state.balance += amount;
  return { wallet: state.balance, bank: state.bank };
});
const collectBankInterest = vi.fn(async () => ({ interest: 0, bank: state.bank }));
vi.mock('../src/utils/economyStore.js', () => ({
  getUserEconomy: (...a) => getUserEconomy(...a),
  depositToBank: (...a) => depositToBank(...a),
  withdrawFromBank: (...a) => withdrawFromBank(...a),
  collectBankInterest: (...a) => collectBankInterest(...a),
}));

const { execute: bankExecute } = await import('../src/commands/economia/bank.js');

function makeInteraction({ guildId = 'guild-1', userId = 'user-1', sub = 'depositar', cantidad = 100 } = {}) {
  return {
    guildId,
    guild: { id: guildId },
    user: { id: userId, tag: `user-${userId}#0001` },
    options: {
      getSubcommand: () => sub,
      getInteger: () => cantidad,
    },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state = { balance: 1000, bank: 0, lastInterestTs: 0 };
});

describe('/bank — lógica básica', () => {
  it('depositar: mueve del wallet al banco', async () => {
    const interaction = makeInteraction({ sub: 'depositar', cantidad: 300 });
    await bankExecute(interaction);

    expect(depositToBank).toHaveBeenCalledWith('guild-1', 'user-1', 300);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Depositaste') }));
  });

  it('depositar sin fondos suficientes: rechaza sin romper', async () => {
    state.balance = 10;
    const interaction = makeInteraction({ sub: 'depositar', cantidad: 300 });

    await bankExecute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No tenés suficientes monedas en el wallet') }));
  });

  it('retirar: mueve del banco al wallet', async () => {
    state.bank = 500;
    const interaction = makeInteraction({ sub: 'retirar', cantidad: 200 });

    await bankExecute(interaction);

    expect(withdrawFromBank).toHaveBeenCalledWith('guild-1', 'user-1', 200);
  });

  it('retirar sin fondos suficientes en el banco: rechaza sin romper', async () => {
    state.bank = 50;
    const interaction = makeInteraction({ sub: 'retirar', cantidad: 200 });

    await bankExecute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No tenés suficientes monedas en el banco') }));
  });

  it('ver: cobra el interés acumulado bajo el mismo lock que depositar/retirar', async () => {
    collectBankInterest.mockResolvedValueOnce({ interest: 42, bank: 542 });
    const interaction = makeInteraction({ sub: 'ver' });

    await bankExecute(interaction);

    expect(collectBankInterest).toHaveBeenCalledWith('guild-1', 'user-1');
    const embed = interaction.editReply.mock.calls[0][0].embeds[0];
    expect(embed.data.description).toContain('42');
  });
});

// Concurrencia real (lock real de asyncLock.js, nunca mockeado) — mismo criterio que
// give.test.js/daily.test.js. El mock simula el round-trip real de la RPC (await entre
// leer y escribir) para que la carrera sea genuina, no solo teórica.
describe('/bank — concurrencia real (mismo usuario vs. distinto, lock real)', () => {
  it('mismo usuario, dos depósitos que juntos exceden el wallet: el segundo se rechaza, nunca queda negativo', async () => {
    state.balance = 100;
    const first = makeInteraction({ userId: 'race-1', sub: 'depositar', cantidad: 80 });
    const second = makeInteraction({ userId: 'race-1', sub: 'depositar', cantidad: 80 });

    await Promise.all([bankExecute(first), bankExecute(second)]);

    // Sin el lock, las dos leerían balance=100 antes de que ninguna escribiera y las
    // dos pasarían — el wallet terminaría en -60. Con el lock, la segunda ve el
    // resultado real de la primera y se rechaza.
    expect(state.balance).toBe(20);
    expect(state.bank).toBe(80);

    const rejections = [first, second].filter((i) =>
      i.editReply.mock.calls.some((call) => call[0]?.content?.includes('No tenés suficientes monedas en el wallet')),
    );
    expect(rejections).toHaveLength(1);
  });

  it('mismo usuario, depósito y retiro simultáneos: se serializan, nunca se pisan', async () => {
    state.balance = 500;
    state.bank = 500;
    const deposit = makeInteraction({ userId: 'race-2', sub: 'depositar', cantidad: 200 });
    const withdraw = makeInteraction({ userId: 'race-2', sub: 'retirar', cantidad: 300 });

    await Promise.all([bankExecute(deposit), bankExecute(withdraw)]);

    // Cualquiera sea el orden real en que corrieron, el total (wallet+banco) tiene que
    // seguir siendo el mismo que al principio — nada se creó ni se perdió.
    expect(state.balance + state.bank).toBe(1000);
  });

  it('usuarios DISTINTOS disparados sin await entre sí: no se bloquean entre ellos', async () => {
    const a = makeInteraction({ userId: 'race-a', sub: 'depositar', cantidad: 50 });
    const b = makeInteraction({ userId: 'race-b', sub: 'depositar', cantidad: 50 });

    await Promise.all([bankExecute(a), bankExecute(b)]);

    expect(depositToBank).toHaveBeenCalledTimes(2);
  });

  it('mismo userId en guilds DISTINTOS: no comparten lock', async () => {
    const inGuildA = makeInteraction({ guildId: 'guild-race-a', userId: 'race-3', sub: 'depositar', cantidad: 50 });
    const inGuildB = makeInteraction({ guildId: 'guild-race-b', userId: 'race-3', sub: 'depositar', cantidad: 50 });

    await Promise.all([bankExecute(inGuildA), bankExecute(inGuildB)]);

    expect(depositToBank).toHaveBeenCalledTimes(2);
  });
});
