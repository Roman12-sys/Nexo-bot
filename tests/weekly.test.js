import { vi, describe, it, expect, beforeEach } from 'vitest';

// Auditoría completa NEXO (2026-09-11): /weekly comparte el mismo patrón exacto de lock
// revalidado en fresco que /daily (ya cubierto), pero nunca tuvo su propio test. Mismo
// mock CON ESTADO que daily.test.js, por el mismo motivo: sin reflejar lo que
// addBalance/setCooldown escriben, una carrera "en paralelo" pasaría igual sin importar
// si el lock funciona.
let economyState;
const getUserEconomy = vi.fn(async () => ({ ...economyState }));
const addBalance = vi.fn(async (guildId, userId, amount) => {
  economyState.balance += amount;
  return economyState.balance;
});
const setCooldown = vi.fn(async (guildId, userId, field, timestamp) => {
  economyState[field === 'weekly' ? 'lastWeekly' : field] = timestamp;
});
vi.mock('../src/utils/economyStore.js', () => ({
  getUserEconomy: (...a) => getUserEconomy(...a),
  addBalance: (...a) => addBalance(...a),
  setCooldown: (...a) => setCooldown(...a),
}));

const { execute: weeklyExecute, COOLDOWN_MS } = await import('../src/commands/economia/weekly.js');

function makeInteraction({ guildId = 'guild-1', userId = 'user-1' } = {}) {
  return {
    guild: { id: guildId },
    user: { id: userId, tag: `user-${userId}#0001` },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  economyState = { balance: 0, lastWeekly: 0 };
});

describe('/weekly — lógica básica', () => {
  it('primer reclamo: acredita dentro del rango documentado (1500-2500)', async () => {
    const interaction = makeInteraction();
    await weeklyExecute(interaction);

    expect(addBalance).toHaveBeenCalledTimes(1);
    const [, , amount, meta] = addBalance.mock.calls[0];
    expect(amount).toBeGreaterThanOrEqual(1500);
    expect(amount).toBeLessThanOrEqual(2500);
    expect(meta).toEqual({ type: 'weekly' });
  });

  it('todavía en cooldown: responde ephemeral sin tocar el balance', async () => {
    economyState.lastWeekly = Date.now();
    const interaction = makeInteraction();

    await weeklyExecute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Ya reclamaste') }));
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(addBalance).not.toHaveBeenCalled();
  });

  it('justo pasado el cooldown de 7 días: se puede reclamar de nuevo', async () => {
    economyState = { balance: 100, lastWeekly: Date.now() - COOLDOWN_MS - 1000 };
    const interaction = makeInteraction();

    await weeklyExecute(interaction);

    expect(addBalance).toHaveBeenCalledTimes(1);
    expect(setCooldown).toHaveBeenCalledWith('guild-1', 'user-1', 'weekly', expect.any(Number));
  });
});

describe('/weekly — concurrencia real (lock real de asyncLock.js)', () => {
  it('mismo usuario, dos /weekly disparados sin await entre sí: se acredita UNA sola vez', async () => {
    const first = makeInteraction({ userId: 'race-1' });
    const second = makeInteraction({ userId: 'race-1' });

    await Promise.all([weeklyExecute(first), weeklyExecute(second)]);

    expect(addBalance).toHaveBeenCalledTimes(1);
    const cooldownReplies = [first, second].filter((i) =>
      i.editReply.mock.calls.some((call) => call[0]?.content?.includes('Ya reclamaste')),
    );
    expect(cooldownReplies).toHaveLength(1);
  });

  it('usuarios DISTINTOS: no se bloquean entre ellos', async () => {
    const a = makeInteraction({ userId: 'race-a' });
    const b = makeInteraction({ userId: 'race-b' });

    await Promise.all([weeklyExecute(a), weeklyExecute(b)]);

    expect(addBalance).toHaveBeenCalledTimes(2);
  });
});
