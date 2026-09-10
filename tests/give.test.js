import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// /give — ECO-2, Fase 4B: antes no existía ningún cooldown propio (giveTracker.js solo
// detecta y loguea DESPUÉS del hecho, nunca bloquea). Mismo patrón que
// tests/encuesta.test.js / tests/confession.test.js — acá el foco es exclusivamente el
// cooldown nuevo, no la lógica de transferencia atómica (transferBalance), que no cambió.
const getUserEconomy = vi.fn();
const transferBalance = vi.fn();
const recordTransaction = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/economyStore.js', () => ({ getUserEconomy, transferBalance, recordTransaction }));

const getGuildLogChannel = vi.fn().mockResolvedValue(null);
vi.mock('../src/utils/guildLogChannels.js', () => ({ getGuildLogChannel }));

const { execute: giveExecute } = await import('../src/commands/economia/give.js');

function makeInteraction({ guildId = 'guild-1', userId = 'user-1', targetId = 'target-1', cantidad = 100, targetIsBot = false } = {}) {
  return {
    guild: { id: guildId },
    guildId,
    client: {},
    user: { id: userId, tag: `user-${userId}#0001` },
    options: {
      getUser: () => ({ id: targetId, tag: `user-${targetId}#0001`, bot: targetIsBot }),
      getInteger: () => cantidad,
    },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  getUserEconomy.mockResolvedValue({ balance: 1000 });
  transferBalance.mockResolvedValue({ senderBalance: 900, receiverBalance: 100 });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('/give — cooldown por guild+emisor (ECO-2)', () => {
  it('primera transferencia: se procesa normalmente', async () => {
    const interaction = makeInteraction({ userId: 'give-1' });

    await giveExecute(interaction);

    expect(transferBalance).toHaveBeenCalledWith('guild-1', 'give-1', 'target-1', 100);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('segunda transferencia RÁPIDA del mismo emisor: bloqueada por cooldown, sin llamar a transferBalance', async () => {
    const first = makeInteraction({ userId: 'give-2' });
    await giveExecute(first);

    const second = makeInteraction({ userId: 'give-2' });
    await giveExecute(second);

    expect(transferBalance).toHaveBeenCalledTimes(1);
    expect(second.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Ya transferiste monedas hace poco') }));
    expect(second.deferReply).not.toHaveBeenCalled();
  });

  it('emisores DISTINTOS no comparten el cooldown', async () => {
    const senderA = makeInteraction({ userId: 'give-a' });
    await giveExecute(senderA);

    const senderB = makeInteraction({ userId: 'give-b' });
    await giveExecute(senderB);

    expect(transferBalance).toHaveBeenCalledTimes(2);
  });

  it('mismo emisor en OTRO servidor: no comparte el cooldown', async () => {
    const inGuildA = makeInteraction({ guildId: 'guild-a', userId: 'give-3' });
    await giveExecute(inGuildA);

    const inGuildB = makeInteraction({ guildId: 'guild-b', userId: 'give-3' });
    await giveExecute(inGuildB);

    expect(transferBalance).toHaveBeenCalledTimes(2);
  });

  it('un intento rechazado por fondos insuficientes no consume el cooldown', async () => {
    getUserEconomy.mockResolvedValueOnce({ balance: 10 }); // no le alcanza para 100
    const insufficient = makeInteraction({ userId: 'give-4' });
    await giveExecute(insufficient);
    expect(insufficient.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No tenés suficientes monedas') }));
    expect(transferBalance).not.toHaveBeenCalled();

    getUserEconomy.mockResolvedValue({ balance: 1000 });
    const retry = makeInteraction({ userId: 'give-4' });
    await giveExecute(retry);

    expect(transferBalance).toHaveBeenCalledTimes(1);
  });

  it('un intento rechazado por auto-transferencia no consume el cooldown', async () => {
    const selfGive = makeInteraction({ userId: 'give-5', targetId: 'give-5' });
    await giveExecute(selfGive);
    expect(selfGive.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('a vos mismo') }));

    const realGive = makeInteraction({ userId: 'give-5' });
    await giveExecute(realGive);

    expect(transferBalance).toHaveBeenCalledTimes(1);
  });

  it('pasada la ventana de cooldown, se puede transferir de nuevo', async () => {
    const first = makeInteraction({ userId: 'give-6' });
    await giveExecute(first);

    vi.setSystemTime(Date.now() + 2 * 60 * 1000 + 1);

    const second = makeInteraction({ userId: 'give-6' });
    await giveExecute(second);

    expect(transferBalance).toHaveBeenCalledTimes(2);
  });

  it('transferBalance tira un error inesperado (no insufficient_funds): se propaga sin manejar acá', async () => {
    transferBalance.mockRejectedValueOnce(new Error('network blip'));
    const interaction = makeInteraction({ userId: 'give-7' });

    await expect(giveExecute(interaction)).rejects.toThrow('network blip');
  });
});

// Auditoría Ciclo 1 (hallazgo Alto) — el cooldown se leía y escribía SIN lock: dos
// /give casi simultáneos del mismo emisor podían los dos leer el cooldown vencido antes
// de que ninguno lo actualizara, y las dos pasaban. Estos tests disparan las dos
// interactions SIN esperar entre sí (Promise.all) contra el `withLock` REAL de
// asyncLock.js (nunca mockeado, mismo criterio que giveawayEngine.test.js) — si alguien
// vuelve a sacar el lock de give.js, "mismo emisor" empieza a fallar (transferBalance
// se llamaría 2 veces en vez de 1) mientras que "emisores/guilds distintos" seguiría
// pasando, aislando exactamente qué se rompió.
describe('/give — concurrencia real (mismo emisor vs. distinto, lock real de asyncLock.js)', () => {
  it('mismo emisor, dos /give disparados sin await entre sí: una sola transferencia real', async () => {
    const first = makeInteraction({ userId: 'give-race-1' });
    const second = makeInteraction({ userId: 'give-race-1' });

    await Promise.all([giveExecute(first), giveExecute(second)]);

    expect(transferBalance).toHaveBeenCalledTimes(1);

    // Exactamente una de las dos interactions tiene que haber recibido el rechazo de
    // cooldown (cuál de las dos gana la carrera no es lo que importa acá) — la prueba
    // real es que NUNCA las dos pasan.
    const cooldownRejections = [first, second].filter((i) =>
      i.editReply.mock.calls.some((call) => call[0]?.content?.includes('Ya transferiste monedas hace poco')),
    );
    expect(cooldownRejections).toHaveLength(1);
  });

  it('emisores DISTINTOS disparados sin await entre sí: no se bloquean entre ellos, las dos pasan', async () => {
    const a = makeInteraction({ userId: 'give-race-a' });
    const b = makeInteraction({ userId: 'give-race-b' });

    await Promise.all([giveExecute(a), giveExecute(b)]);

    expect(transferBalance).toHaveBeenCalledTimes(2);
  });

  it('mismo userId en guilds DISTINTOS disparados sin await entre sí: no comparten lock, las dos pasan', async () => {
    const inGuildA = makeInteraction({ guildId: 'guild-race-a', userId: 'give-race-2' });
    const inGuildB = makeInteraction({ guildId: 'guild-race-b', userId: 'give-race-2' });

    await Promise.all([giveExecute(inGuildA), giveExecute(inGuildB)]);

    expect(transferBalance).toHaveBeenCalledTimes(2);
  });
});
