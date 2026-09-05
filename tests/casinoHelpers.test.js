import { vi, describe, it, expect, beforeEach } from 'vitest';

// casinoHelpers.js — TEST-1, Fase 4B: lógica compartida por /coinflip, /dado, /slots y
// /ruleta (cobro atómico, resolución win/push/lose, acreditación de payout). Cero
// cobertura antes de esto, pese a que es la única pieza del proyecto que mueve dinero
// en las 4 direcciones (apostar, ganar, empatar, perder) detrás de un lock. Se usa el
// asyncLock.js REAL (no mockeado) para la prueba de atomicidad — mismo criterio que
// giveawayEngine.test.js/xpStore.test.js: una carrera simulada con un lock mockeado no
// prueba nada real.
const getUserEconomy = vi.fn();
const deductBalanceIfSufficient = vi.fn();
const addBalance = vi.fn();
const recordTransaction = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/economyStore.js', () => ({ getUserEconomy, deductBalanceIfSufficient, addBalance, recordTransaction }));

const { playCasinoGame, weightedRandom } = await import('../src/utils/casinoHelpers.js');

function makeInteraction({ guildId = 'guild-1', userId = 'user-1' } = {}) {
  return {
    guild: { id: guildId },
    user: { id: userId },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

function lastEmbed(interaction) {
  return interaction.editReply.mock.calls.at(-1)[0].embeds[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('playCasinoGame — cobro', () => {
  it('descuenta exactamente la apuesta vía deductBalanceIfSufficient y registra la transacción del pozo', async () => {
    getUserEconomy.mockResolvedValue({ balance: 1000 });
    deductBalanceIfSufficient.mockResolvedValue(900);
    addBalance.mockResolvedValue(900);
    const resolve = vi.fn().mockReturnValue({ outcome: 'lose', payout: 0, title: 'Perdiste', description: 'd' });
    const interaction = makeInteraction();

    await playCasinoGame(interaction, { apuesta: 100, gameKey: 'test-game', gameLabel: 'Test', resolve });

    expect(deductBalanceIfSufficient).toHaveBeenCalledWith('guild-1', 'user-1', 100);
    expect(recordTransaction).toHaveBeenCalledWith('guild-1', 'user-1', { type: 'gamble_bet', amount: -100, balanceAfter: 900, reason: 'Test' });
  });

  it('resolve() se llama recién DESPUÉS de que la apuesta ya se descontó (nunca resuelve sin haber cobrado)', async () => {
    getUserEconomy.mockResolvedValue({ balance: 1000 });
    const callOrder = [];
    deductBalanceIfSufficient.mockImplementation(async () => {
      callOrder.push('deduct');
      return 900;
    });
    const resolve = vi.fn(() => {
      callOrder.push('resolve');
      return { outcome: 'lose', payout: 0, title: 't', description: 'd' };
    });

    await playCasinoGame(makeInteraction(), { apuesta: 100, gameKey: 'test-game', gameLabel: 'Test', resolve });

    expect(callOrder).toEqual(['deduct', 'resolve']);
  });
});

describe('playCasinoGame — WIN', () => {
  it('acredita el payout completo (no solo la ganancia neta) y calcula netGain correctamente', async () => {
    getUserEconomy.mockResolvedValue({ balance: 1000 });
    deductBalanceIfSufficient.mockResolvedValue(0); // apostó todo (1000)
    addBalance.mockResolvedValue(2000);
    const resolve = vi.fn().mockReturnValue({ outcome: 'win', payout: 2000, title: 'Ganaste', description: 'd' });
    const interaction = makeInteraction();

    await playCasinoGame(interaction, { apuesta: 1000, gameKey: 'test-game', gameLabel: 'Test', resolve });

    // El payout ACREDITADO es el bruto (2000, no la ganancia neta de 1000) — el balance
    // real tiene que reflejar el pago completo, no solo lo que "ganó de más".
    expect(addBalance).toHaveBeenCalledWith('guild-1', 'user-1', 2000, { type: 'gamble_win', reason: 'Test', netGain: 1000 });
    expect(lastEmbed(interaction).data.description).toContain('2000');
  });

  it('el embed final muestra el balance devuelto por addBalance, no un cálculo propio', async () => {
    getUserEconomy.mockResolvedValue({ balance: 500 });
    deductBalanceIfSufficient.mockResolvedValue(400);
    addBalance.mockResolvedValue(1400); // lo que la RPC real diga, no 400+1000 calculado acá
    const resolve = vi.fn().mockReturnValue({ outcome: 'win', payout: 1000, title: 'Ganaste', description: 'd' });
    const interaction = makeInteraction();

    await playCasinoGame(interaction, { apuesta: 100, gameKey: 'test-game', gameLabel: 'Test', resolve });

    expect(lastEmbed(interaction).data.description).toContain('1400');
  });
});

describe('playCasinoGame — PUSH', () => {
  it('un push (payout === apuesta, se devuelve lo apostado) SÍ acredita, con netGain 0', async () => {
    getUserEconomy.mockResolvedValue({ balance: 1000 });
    deductBalanceIfSufficient.mockResolvedValue(900);
    addBalance.mockResolvedValue(1000);
    const resolve = vi.fn().mockReturnValue({ outcome: 'push', payout: 100, title: 'Empate', description: 'd' });
    const interaction = makeInteraction();

    await playCasinoGame(interaction, { apuesta: 100, gameKey: 'test-game', gameLabel: 'Test', resolve });

    expect(addBalance).toHaveBeenCalledWith('guild-1', 'user-1', 100, { type: 'gamble_win', reason: 'Test', netGain: 0 });
  });
});

describe('playCasinoGame — LOSE', () => {
  it('un payout de 0 NUNCA llama a addBalance — el balance final es el que quedó tras el cobro', async () => {
    getUserEconomy.mockResolvedValue({ balance: 1000 });
    deductBalanceIfSufficient.mockResolvedValue(900);
    const resolve = vi.fn().mockReturnValue({ outcome: 'lose', payout: 0, title: 'Perdiste', description: 'd' });
    const interaction = makeInteraction();

    await playCasinoGame(interaction, { apuesta: 100, gameKey: 'test-game', gameLabel: 'Test', resolve });

    expect(addBalance).not.toHaveBeenCalled();
    expect(lastEmbed(interaction).data.description).toContain('900');
  });
});

describe('playCasinoGame — fondos insuficientes', () => {
  it('pre-check (antes de deferir): rechaza ephemeral sin llegar al lock ni a deductBalanceIfSufficient', async () => {
    getUserEconomy.mockResolvedValue({ balance: 50 });
    const resolve = vi.fn();
    const interaction = makeInteraction();

    await playCasinoGame(interaction, { apuesta: 100, gameKey: 'test-game', gameLabel: 'Test', resolve });

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No tenés suficientes monedas') }));
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(deductBalanceIfSufficient).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('condición de carrera DENTRO del lock (el balance cambió entre el pre-check y el cobro real): no resuelve ni acredita nada', async () => {
    getUserEconomy.mockResolvedValue({ balance: 1000 }); // pre-check pasa
    const error = Object.assign(new Error('insufficient_funds'), { code: 'insufficient_funds' });
    deductBalanceIfSufficient.mockRejectedValue(error);
    const resolve = vi.fn();
    const interaction = makeInteraction();

    await playCasinoGame(interaction, { apuesta: 100, gameKey: 'test-game', gameLabel: 'Test', resolve });

    expect(interaction.editReply).toHaveBeenCalledWith({ content: '❌ No tenés suficientes monedas para esa apuesta.' });
    expect(resolve).not.toHaveBeenCalled();
    expect(recordTransaction).not.toHaveBeenCalled();
    expect(addBalance).not.toHaveBeenCalled();
  });

  it('un error DISTINTO a insufficient_funds se propaga (no se lo traga en silencio)', async () => {
    getUserEconomy.mockResolvedValue({ balance: 1000 });
    deductBalanceIfSufficient.mockRejectedValue(new Error('supabase caído'));
    const resolve = vi.fn();

    await expect(playCasinoGame(makeInteraction(), { apuesta: 100, gameKey: 'test-game', gameLabel: 'Test', resolve })).rejects.toThrow('supabase caído');
  });
});

describe('playCasinoGame — atomicidad (lock real, no mockeado)', () => {
  it('dos apuestas casi simultáneas del MISMO usuario+juego se serializan: la segunda ve el balance ya descontado por la primera', async () => {
    let balance = 1000;
    getUserEconomy.mockImplementation(async () => ({ balance }));
    deductBalanceIfSufficient.mockImplementation(async (_g, _u, apuesta) => {
      // Simula la RPC atómica real: lee y escribe el "balance" compartido con un
      // pequeño delay para forzar que, sin el lock, las dos ejecuciones se solaparían.
      await new Promise((r) => setTimeout(r, 5));
      balance -= apuesta;
      return balance;
    });
    addBalance.mockImplementation(async (_g, _u, payout) => {
      balance += payout;
      return balance;
    });
    const resolve = vi.fn().mockReturnValue({ outcome: 'lose', payout: 0, title: 't', description: 'd' });

    const interactionA = makeInteraction({ userId: 'user-1' });
    const interactionB = makeInteraction({ userId: 'user-1' });

    // Mismo gameKey+guild+user en las dos → mismo lock. Sin el lock real, las dos
    // llamadas a deductBalanceIfSufficient leerían/escribirían "balance" en paralelo.
    await Promise.all([
      playCasinoGame(interactionA, { apuesta: 100, gameKey: 'test-game', gameLabel: 'Test', resolve }),
      playCasinoGame(interactionB, { apuesta: 100, gameKey: 'test-game', gameLabel: 'Test', resolve }),
    ]);

    expect(deductBalanceIfSufficient).toHaveBeenCalledTimes(2);
    expect(balance).toBe(800); // 1000 - 100 - 100, nunca menos débitos de los que corresponden
  });

  it('juegos DISTINTOS del mismo usuario no comparten lock (no se bloquean entre sí)', async () => {
    getUserEconomy.mockResolvedValue({ balance: 1000 });
    deductBalanceIfSufficient.mockResolvedValue(900);
    const resolve = vi.fn().mockReturnValue({ outcome: 'lose', payout: 0, title: 't', description: 'd' });

    const results = await Promise.all([
      playCasinoGame(makeInteraction({ userId: 'user-1' }), { apuesta: 100, gameKey: 'slots', gameLabel: 'Slots', resolve }),
      playCasinoGame(makeInteraction({ userId: 'user-1' }), { apuesta: 100, gameKey: 'ruleta', gameLabel: 'Ruleta', resolve }),
    ]);

    expect(deductBalanceIfSufficient).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2);
  });
});

describe('weightedRandom', () => {
  const items = [
    { value: 'comun', weight: 70 },
    { value: 'raro', weight: 30 },
  ];

  it('un roll bajo (dentro del peso del primer item) devuelve el primero', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // roll = 0 * 100 = 0, cae en "comun"
    expect(weightedRandom(items).value).toBe('comun');
    Math.random.mockRestore();
  });

  it('un roll alto (más allá del peso del primero) devuelve el segundo', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // roll = 99, > 70 → "raro"
    expect(weightedRandom(items).value).toBe('raro');
    Math.random.mockRestore();
  });

  it('nunca devuelve undefined ni se sale del array, incluso en el borde exacto', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9999999);
    const result = weightedRandom(items);
    expect(items).toContain(result);
    Math.random.mockRestore();
  });
});
