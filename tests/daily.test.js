import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Auditoría completa NEXO (2026-09-11): /daily comparte exactamente el mismo patrón de
// lock revalidado en fresco que /rob, /crime y /give (que ya tienen test de carrera
// real) — pero nunca tuvo su propio test, pese a ser uno de los comandos de mayor uso
// esperado en cualquier server nuevo. El mock de economyStore es CON ESTADO (no un
// vi.fn plano) a propósito: si el mock no reflejara lo que addBalance/setDailyClaim
// escriben, una segunda llamada "en carrera" pasaría igual sin importar si el lock
// funciona — el mock con estado es lo único que hace que este test pueda fallar de
// verdad si alguien saca el lock de daily.js.
let economyState;
const getUserEconomy = vi.fn(async () => ({ ...economyState }));
const addBalance = vi.fn(async (guildId, userId, amount) => {
  economyState.balance += amount;
  return economyState.balance;
});
const setDailyClaim = vi.fn(async (guildId, userId, { timestamp, streak }) => {
  economyState.lastDaily = timestamp;
  economyState.dailyStreak = streak;
});
vi.mock('../src/utils/economyStore.js', () => ({
  getUserEconomy: (...a) => getUserEconomy(...a),
  addBalance: (...a) => addBalance(...a),
  setDailyClaim: (...a) => setDailyClaim(...a),
}));

const emit = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/eventBus.js', () => ({ eventBus: { emit } }));

const { execute: dailyExecute, COOLDOWN_MS } = await import('../src/commands/economia/daily.js');

function makeInteraction({ guildId = 'guild-1', userId = 'user-1' } = {}) {
  const guild = { id: guildId };
  return {
    guild,
    user: { id: userId, tag: `user-${userId}#0001` },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  economyState = { balance: 0, lastDaily: 0, dailyStreak: 0 };
});

describe('/daily — lógica básica', () => {
  it('primer reclamo: acredita el rango correcto y no menciona racha', async () => {
    const interaction = makeInteraction();
    await dailyExecute(interaction);

    expect(addBalance).toHaveBeenCalledTimes(1);
    const [, , amount] = addBalance.mock.calls[0];
    expect(amount).toBeGreaterThanOrEqual(100);
    expect(amount).toBeLessThanOrEqual(300); // sin bonus de racha en el primer daily
    expect(emit).toHaveBeenCalledWith('ACHIEVEMENT_CHECK', expect.objectContaining({ achievementId: 'primera_moneda' }));
  });

  it('todavía en cooldown: responde ephemeral sin tocar el balance', async () => {
    economyState.lastDaily = Date.now();
    const interaction = makeInteraction();

    await dailyExecute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Ya reclamaste') }));
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(addBalance).not.toHaveBeenCalled();
  });

  it('dentro de la ventana de gracia (< 48h): la racha continúa', async () => {
    economyState = { balance: 500, lastDaily: Date.now() - COOLDOWN_MS - 1000, dailyStreak: 3 };
    const interaction = makeInteraction();

    await dailyExecute(interaction);

    expect(setDailyClaim).toHaveBeenCalledWith('guild-1', 'user-1', expect.objectContaining({ streak: 4 }));
  });

  it('pasada la ventana de gracia (> 48h): la racha se reinicia a 1', async () => {
    economyState = { balance: 500, lastDaily: Date.now() - COOLDOWN_MS * 3, dailyStreak: 10 };
    const interaction = makeInteraction();

    await dailyExecute(interaction);

    expect(setDailyClaim).toHaveBeenCalledWith('guild-1', 'user-1', expect.objectContaining({ streak: 1 }));
  });
});

// Concurrencia real (lock real de asyncLock.js, nunca mockeado) — mismo criterio que
// give.test.js/rob.test.js/crime.test.js.
describe('/daily — concurrencia real (mismo usuario vs. distinto, lock real)', () => {
  it('mismo usuario, dos /daily disparados sin await entre sí: se acredita UNA sola vez', async () => {
    const first = makeInteraction({ userId: 'race-1' });
    const second = makeInteraction({ userId: 'race-1' });

    await Promise.all([dailyExecute(first), dailyExecute(second)]);

    expect(addBalance).toHaveBeenCalledTimes(1);

    const cooldownReplies = [first, second].filter((i) =>
      i.editReply.mock.calls.some((call) => call[0]?.content?.includes('Ya reclamaste')),
    );
    expect(cooldownReplies).toHaveLength(1);
  });

  it('usuarios DISTINTOS disparados sin await entre sí: no se bloquean, los dos cobran', async () => {
    const a = makeInteraction({ userId: 'race-a' });
    const b = makeInteraction({ userId: 'race-b' });

    await Promise.all([dailyExecute(a), dailyExecute(b)]);

    expect(addBalance).toHaveBeenCalledTimes(2);
  });

  it('mismo userId en guilds DISTINTOS: no comparten lock, los dos cobran', async () => {
    const inGuildA = makeInteraction({ guildId: 'guild-race-a', userId: 'race-2' });
    const inGuildB = makeInteraction({ guildId: 'guild-race-b', userId: 'race-2' });

    await Promise.all([dailyExecute(inGuildA), dailyExecute(inGuildB)]);

    expect(addBalance).toHaveBeenCalledTimes(2);
  });
});
