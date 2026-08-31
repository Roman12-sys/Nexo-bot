import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eventBus } from '../src/utils/eventBus.js';

// giveawayEngine.js importa giveawaysStore.js, que a su vez importa supabaseClient.js
// (requiere variables de entorno reales). Se mockea para testear pickWinners() aislado.
vi.mock('../src/supabaseClient.js', () => ({ supabase: {} }));

// Para scheduling/finalización/catch-up se mockean giveawaysStore.js y achievements.js
// directamente (no supabase de bajo nivel) — son las dos únicas dependencias con I/O de
// endGiveaway/scheduleGiveawayEnd/rescheduleActiveGiveaways. Nada de esto es un test de
// integración: no hay RPCs ni red real en ningún punto.
const getGiveaway = vi.fn();
const updateGiveaway = vi.fn();
const getActiveGiveaways = vi.fn();
vi.mock('../src/utils/giveawaysStore.js', () => ({ getGiveaway, updateGiveaway, getActiveGiveaways }));

// achievements.js YA NO se llama directo desde acá (consolidación del Event Engine,
// auditoría 2026-08-29 — ver CLAUDE.md "Logros — consolidados en un solo handler"):
// endGiveaway emite ACHIEVEMENT_CHECK vía eventBus, y es achievements.js (probado aparte
// en achievements.test.js) el único consumidor que después llama unlockAchievement. Acá
// alcanza con espiar eventBus.emit — mismo patrón que economyStore.test.js usa para
// COINS_EARNED/COINS_DESTROYED.
const { pickWinners, endGiveaway, scheduleGiveawayEnd, rescheduleActiveGiveaways } = await import('../src/utils/giveawayEngine.js');

function makeGiveaway(overrides = {}) {
  return {
    guildId: 'guild-1',
    messageId: 'msg-1',
    channelId: 'channel-1',
    prize: 'un premio',
    winnersCount: 1,
    participants: ['user-1', 'user-2'],
    ended: false,
    endTimestamp: Date.now() + 60_000,
    ...overrides,
  };
}

function makeClient({ messageFetchResult } = {}) {
  const message = { edit: vi.fn().mockResolvedValue(undefined) };
  const channel = {
    messages: { fetch: vi.fn().mockResolvedValue(messageFetchResult === undefined ? message : messageFetchResult) },
    send: vi.fn().mockResolvedValue(undefined),
  };
  return { channels: { fetch: vi.fn().mockResolvedValue(channel) }, channel, message };
}

describe('pickWinners', () => {
  it('nunca elige más ganadores de los que hay participantes', () => {
    const winners = pickWinners(['a', 'b'], 5);
    expect(winners.length).toBe(2);
  });

  it('elige exactamente "count" ganadores cuando hay participantes de sobra', () => {
    const participants = Array.from({ length: 20 }, (_, i) => `user${i}`);
    const winners = pickWinners(participants, 3);
    expect(winners.length).toBe(3);
  });

  it('nunca repite un ganador', () => {
    const participants = Array.from({ length: 30 }, (_, i) => `user${i}`);
    const winners = pickWinners(participants, 10);
    expect(new Set(winners).size).toBe(winners.length);
  });

  it('todos los ganadores salen de la lista de participantes', () => {
    const participants = ['a', 'b', 'c', 'd'];
    const winners = pickWinners(participants, 4);
    for (const w of winners) expect(participants).toContain(w);
  });

  it('no modifica el array de participantes original', () => {
    const participants = ['a', 'b', 'c'];
    const copy = [...participants];
    pickWinners(participants, 2);
    expect(participants).toEqual(copy);
  });

  it('lista vacía de participantes no elige a nadie', () => {
    expect(pickWinners([], 3)).toEqual([]);
  });
});

describe('endGiveaway', () => {
  let emitSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    updateGiveaway.mockImplementation(async (guildId, messageId, updates) => ({ ...makeGiveaway(), ...updates }));
    emitSpy = vi.spyOn(eventBus, 'emit').mockResolvedValue(undefined);
  });

  afterEach(() => {
    emitSpy.mockRestore();
  });

  it('con participantes: elige ganador, marca ended y anuncia en el canal', async () => {
    const giveaway = makeGiveaway();
    getGiveaway.mockResolvedValue(giveaway);
    const client = makeClient();

    await endGiveaway(client, 'guild-1', 'msg-1');

    expect(updateGiveaway).toHaveBeenCalledWith('guild-1', 'msg-1', expect.objectContaining({ ended: true, winners: expect.any(Array) }));
    expect(client.message.edit).toHaveBeenCalled();
    expect(client.channel.send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Felicidades') }));
    expect(emitSpy).toHaveBeenCalledWith('ACHIEVEMENT_CHECK', { guildId: 'guild-1', userId: expect.any(String), achievementId: 'con_suerte' });
  });

  it('sin participantes: avisa que nadie participó y no desbloquea logros', async () => {
    getGiveaway.mockResolvedValue(makeGiveaway({ participants: [] }));
    const client = makeClient();

    await endGiveaway(client, 'guild-1', 'msg-1');

    expect(client.channel.send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Nadie participó') }));
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('un giveaway que ya estaba ended no se vuelve a procesar (protección contra doble finalización)', async () => {
    getGiveaway.mockResolvedValue(makeGiveaway({ ended: true }));
    const client = makeClient();

    const result = await endGiveaway(client, 'guild-1', 'msg-1');

    expect(result).toBeNull();
    expect(updateGiveaway).not.toHaveBeenCalled();
  });

  it('un giveaway que ya no existe (borrado) no revienta', async () => {
    getGiveaway.mockResolvedValue(null);
    const client = makeClient();

    await expect(endGiveaway(client, 'guild-1', 'msg-1')).resolves.toBeNull();
    expect(updateGiveaway).not.toHaveBeenCalled();
  });
});

describe('scheduleGiveawayEnd — timer en memoria', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    updateGiveaway.mockImplementation(async (guildId, messageId, updates) => ({ ...makeGiveaway(), ...updates }));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('no termina el sorteo antes de tiempo', async () => {
    getGiveaway.mockResolvedValue(makeGiveaway());
    const client = makeClient();

    scheduleGiveawayEnd(client, 'guild-1', 'msg-1', 60_000);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(updateGiveaway).not.toHaveBeenCalled();
  });

  it('termina el sorteo solo cuando se cumple el delay', async () => {
    getGiveaway.mockResolvedValue(makeGiveaway());
    const client = makeClient();

    scheduleGiveawayEnd(client, 'guild-1', 'msg-1', 60_000);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(updateGiveaway).toHaveBeenCalledWith('guild-1', 'msg-1', expect.objectContaining({ ended: true }));
  });
});

describe('rescheduleActiveGiveaways — recuperación después de un restart', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    updateGiveaway.mockImplementation(async (guildId, messageId, updates) => ({ ...makeGiveaway(), ...updates }));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('un sorteo cuyo tiempo ya venció mientras el bot estaba apagado termina de inmediato al arrancar', async () => {
    getActiveGiveaways.mockResolvedValue([{ guildId: 'guild-1', messageId: 'msg-vencido', endTimestamp: Date.now() - 5_000 }]);
    getGiveaway.mockResolvedValue(makeGiveaway({ messageId: 'msg-vencido' }));
    const client = makeClient();

    await rescheduleActiveGiveaways(client);

    expect(updateGiveaway).toHaveBeenCalledWith('guild-1', 'msg-vencido', expect.objectContaining({ ended: true }));
  });

  it('un sorteo que todavía no venció se reprograma, no se termina de inmediato', async () => {
    getActiveGiveaways.mockResolvedValue([{ guildId: 'guild-1', messageId: 'msg-futuro', endTimestamp: Date.now() + 60_000 }]);
    getGiveaway.mockResolvedValue(makeGiveaway({ messageId: 'msg-futuro' }));
    const client = makeClient();

    await rescheduleActiveGiveaways(client);
    expect(updateGiveaway).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(updateGiveaway).toHaveBeenCalledWith('guild-1', 'msg-futuro', expect.objectContaining({ ended: true }));
  });
});
