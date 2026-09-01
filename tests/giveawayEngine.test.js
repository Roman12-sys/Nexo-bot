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
const getGiveawaysPendingAnnouncement = vi.fn();
vi.mock('../src/utils/giveawaysStore.js', () => ({
  getGiveaway,
  updateGiveaway,
  getActiveGiveaways,
  getGiveawaysPendingAnnouncement,
}));

// achievements.js YA NO se llama directo desde acá (consolidación del Event Engine,
// auditoría 2026-08-29 — ver CLAUDE.md "Logros — consolidados en un solo handler"):
// endGiveaway emite ACHIEVEMENT_CHECK vía eventBus, y es achievements.js (probado aparte
// en achievements.test.js) el único consumidor que después llama unlockAchievement. Acá
// alcanza con espiar eventBus.emit — mismo patrón que economyStore.test.js usa para
// COINS_EARNED/COINS_DESTROYED.
const {
  pickWinners,
  endGiveaway,
  rerollGiveaway,
  cancelGiveaway,
  scheduleGiveawayEnd,
  rescheduleActiveGiveaways,
  reconcilePendingGiveawayAnnouncements,
  startGiveawayReconcileLoop,
} = await import('../src/utils/giveawayEngine.js');

function makeGiveaway(overrides = {}) {
  return {
    guildId: 'guild-1',
    messageId: 'msg-1',
    channelId: 'channel-1',
    prize: 'un premio',
    winnersCount: 1,
    participants: ['user-1', 'user-2'],
    ended: false,
    winners: [],
    cancelled: false,
    winnersAnnouncedAt: null,
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
    // Simula la escritura real: cada updateGiveaway devuelve el estado ya fusionado,
    // como haría giveawaysStore.updateGiveaway pegándole a Supabase de verdad.
    let current = makeGiveaway();
    getGiveaway.mockImplementation(async () => current);
    updateGiveaway.mockImplementation(async (guildId, messageId, updates) => {
      current = { ...current, ...updates };
      return current;
    });
    emitSpy = vi.spyOn(eventBus, 'emit').mockResolvedValue(undefined);
  });

  afterEach(() => {
    emitSpy.mockRestore();
  });

  it('con participantes: elige ganador, marca ended, anuncia y marca winnersAnnouncedAt', async () => {
    getGiveaway.mockImplementation(async () => makeGiveaway());
    updateGiveaway.mockImplementation(async (guildId, messageId, updates) => ({ ...makeGiveaway(), ...updates }));
    const client = makeClient();

    const result = await endGiveaway(client, 'guild-1', 'msg-1');

    expect(updateGiveaway).toHaveBeenCalledWith('guild-1', 'msg-1', expect.objectContaining({ ended: true, winners: expect.any(Array) }));
    expect(updateGiveaway).toHaveBeenCalledWith('guild-1', 'msg-1', { winnersAnnouncedAt: expect.any(Number) });
    expect(client.message.edit).toHaveBeenCalled();
    expect(client.channel.send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Felicidades') }));
    expect(emitSpy).toHaveBeenCalledWith('ACHIEVEMENT_CHECK', { guildId: 'guild-1', userId: expect.any(String), achievementId: 'con_suerte' });
    expect(result.winnersAnnouncedAt).toEqual(expect.any(Number));
  });

  it('sin participantes: avisa que nadie participó y no desbloquea logros', async () => {
    getGiveaway.mockImplementation(async () => makeGiveaway({ participants: [] }));
    updateGiveaway.mockImplementation(async (guildId, messageId, updates) => ({ ...makeGiveaway({ participants: [] }), ...updates }));
    const client = makeClient();

    await endGiveaway(client, 'guild-1', 'msg-1');

    expect(client.channel.send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Nadie participó') }));
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('un giveaway ya anunciado (winnersAnnouncedAt seteado) no se vuelve a procesar', async () => {
    getGiveaway.mockImplementation(async () => makeGiveaway({ ended: true, winners: ['user-1'], winnersAnnouncedAt: Date.now() }));
    const client = makeClient();

    const result = await endGiveaway(client, 'guild-1', 'msg-1');

    expect(result).toBeNull();
    expect(updateGiveaway).not.toHaveBeenCalled();
    expect(client.channel.send).not.toHaveBeenCalled();
  });

  it('Caso B — ended=true pero sin anunciar (crash entre persistir ganadores y avisar): reanuncia SIN recalcular ganadores', async () => {
    const stuck = makeGiveaway({ ended: true, winners: ['user-2'], winnersAnnouncedAt: null });
    getGiveaway.mockImplementation(async () => stuck);
    updateGiveaway.mockImplementation(async (guildId, messageId, updates) => ({ ...stuck, ...updates }));
    const client = makeClient();

    const result = await endGiveaway(client, 'guild-1', 'msg-1');

    // pickWinners no se llama de nuevo: el único update que ocurre es el de
    // winnersAnnouncedAt, nunca uno que vuelva a mandar "winners".
    expect(updateGiveaway).toHaveBeenCalledTimes(1);
    expect(updateGiveaway).toHaveBeenCalledWith('guild-1', 'msg-1', { winnersAnnouncedAt: expect.any(Number) });
    expect(client.channel.send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('user-2') }));
    expect(result.winnersAnnouncedAt).toEqual(expect.any(Number));
  });

  it('si el anuncio falla (ej. rate limit), NO marca winnersAnnouncedAt — queda pendiente para reintentar', async () => {
    const stuck = makeGiveaway({ ended: true, winners: ['user-1'], winnersAnnouncedAt: null });
    getGiveaway.mockImplementation(async () => stuck);
    updateGiveaway.mockImplementation(async (guildId, messageId, updates) => ({ ...stuck, ...updates }));
    const client = makeClient();
    client.channel.send.mockRejectedValueOnce(new Error('rate limited'));

    const result = await endGiveaway(client, 'guild-1', 'msg-1');

    expect(updateGiveaway).not.toHaveBeenCalled();
    expect(result.winnersAnnouncedAt).toBeNull();
  });

  it('un giveaway que ya no existe (borrado) no revienta', async () => {
    getGiveaway.mockImplementation(async () => null);
    const client = makeClient();

    await expect(endGiveaway(client, 'guild-1', 'msg-1')).resolves.toBeNull();
    expect(updateGiveaway).not.toHaveBeenCalled();
  });

  it('canal borrado: se marca como resuelto igual (no queda reintentando para siempre)', async () => {
    const giveaway = makeGiveaway();
    getGiveaway.mockImplementation(async () => giveaway);
    updateGiveaway.mockImplementation(async (guildId, messageId, updates) => ({ ...giveaway, ...updates }));
    const client = makeClient();
    client.channels.fetch.mockResolvedValue(null);

    const result = await endGiveaway(client, 'guild-1', 'msg-1');

    expect(result.winnersAnnouncedAt).toEqual(expect.any(Number));
  });

  it('participar vs cerrar: dos llamadas concurrentes al mismo sorteo se serializan por el lock (una sola termina anunciando)', async () => {
    let state = makeGiveaway();
    getGiveaway.mockImplementation(async () => state);
    updateGiveaway.mockImplementation(async (guildId, messageId, updates) => {
      state = { ...state, ...updates };
      return state;
    });
    const client = makeClient();

    const [a, b] = await Promise.all([endGiveaway(client, 'guild-1', 'msg-1'), endGiveaway(client, 'guild-1', 'msg-1')]);

    // Solo una de las dos llamadas debió mandar el anuncio de verdad.
    expect(client.channel.send).toHaveBeenCalledTimes(1);
    expect([a, b].filter((r) => r !== null).length).toBe(1);
  });
});

describe('rerollGiveaway', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('excluye a los ganadores existentes del pool cuando hay otra gente para elegir', async () => {
    const giveaway = makeGiveaway({ ended: true, winners: ['user-1'], participants: ['user-1', 'user-2', 'user-3'], winnersCount: 1 });
    getGiveaway.mockResolvedValue(giveaway);
    updateGiveaway.mockImplementation(async (guildId, messageId, updates) => ({ ...giveaway, ...updates }));
    const client = makeClient();

    const result = await rerollGiveaway(client, 'guild-1', 'msg-1');

    expect(result.giveaway.winners).not.toContain('user-1');
    expect(client.channel.send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Reroll') }));
  });

  it('si TODOS los participantes ya ganaron, vuelve a elegir del pool completo (no queda sin ganador)', async () => {
    const giveaway = makeGiveaway({ ended: true, winners: ['user-1', 'user-2'], participants: ['user-1', 'user-2'], winnersCount: 1 });
    getGiveaway.mockResolvedValue(giveaway);
    updateGiveaway.mockImplementation(async (guildId, messageId, updates) => ({ ...giveaway, ...updates }));
    const client = makeClient();

    const result = await rerollGiveaway(client, 'guild-1', 'msg-1');

    expect(result.giveaway.winners.length).toBe(1);
    expect(['user-1', 'user-2']).toContain(result.giveaway.winners[0]);
  });

  it('sorteo todavía activo: rechaza sin tocar Supabase', async () => {
    getGiveaway.mockResolvedValue(makeGiveaway({ ended: false }));
    const client = makeClient();

    const result = await rerollGiveaway(client, 'guild-1', 'msg-1');

    expect(result.error).toBe('not_ended');
    expect(updateGiveaway).not.toHaveBeenCalled();
  });

  it('sorteo cancelado: rechaza', async () => {
    getGiveaway.mockResolvedValue(makeGiveaway({ ended: true, cancelled: true }));
    const client = makeClient();

    const result = await rerollGiveaway(client, 'guild-1', 'msg-1');

    expect(result.error).toBe('cancelled');
  });

  it('dos reroll simultáneos del mismo sorteo se serializan (nunca leen el mismo estado viejo a la vez)', async () => {
    const giveaway = makeGiveaway({ ended: true, winners: ['user-1'], participants: ['user-1', 'user-2', 'user-3'], winnersCount: 1 });
    let callCount = 0;
    getGiveaway.mockImplementation(async () => giveaway);
    updateGiveaway.mockImplementation(async (guildId, messageId, updates) => {
      callCount += 1;
      const merged = { ...giveaway, ...updates };
      // El segundo reroll, si el lock funciona, ve los ganadores que dejó el primero.
      Object.assign(giveaway, merged);
      return merged;
    });
    const client = makeClient();

    const [r1, r2] = await Promise.all([
      rerollGiveaway(client, 'guild-1', 'msg-1'),
      rerollGiveaway(client, 'guild-1', 'msg-1'),
    ]);

    // Ambos corrieron (no se pisaron: 2 updates, uno por cada reroll serializado).
    expect(callCount).toBe(2);
    expect(r1.giveaway).toBeDefined();
    expect(r2.giveaway).toBeDefined();
  });
});

describe('cancelGiveaway', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cancela un sorteo activo: ended+cancelled, edita el mensaje sin botones', async () => {
    const giveaway = makeGiveaway({ ended: false });
    getGiveaway.mockResolvedValue(giveaway);
    updateGiveaway.mockImplementation(async (guildId, messageId, updates) => ({ ...giveaway, ...updates }));
    const client = makeClient();

    const result = await cancelGiveaway(client, 'guild-1', 'msg-1');

    expect(result.giveaway.ended).toBe(true);
    expect(result.giveaway.cancelled).toBe(true);
    expect(client.message.edit).toHaveBeenCalledWith(expect.objectContaining({ components: [] }));
    expect(client.channel.send).not.toHaveBeenCalled(); // cancelar no anuncia ganadores
  });

  it('no encontrado: rechaza sin tocar Supabase', async () => {
    getGiveaway.mockResolvedValue(null);
    const client = makeClient();

    const result = await cancelGiveaway(client, 'guild-1', 'msg-1');

    expect(result.error).toBe('not_found');
    expect(updateGiveaway).not.toHaveBeenCalled();
  });

  it('sorteo ya finalizado: rechaza, no lo pisa', async () => {
    getGiveaway.mockResolvedValue(makeGiveaway({ ended: true, winnersAnnouncedAt: Date.now() }));
    const client = makeClient();

    const result = await cancelGiveaway(client, 'guild-1', 'msg-1');

    expect(result.error).toBe('already_ended');
    expect(updateGiveaway).not.toHaveBeenCalled();
  });

  it('cancelar corriendo justo cuando el timer de cierre también dispara: se serializan, nunca ambos ganan', async () => {
    let state = makeGiveaway({ ended: false });
    getGiveaway.mockImplementation(async () => state);
    updateGiveaway.mockImplementation(async (guildId, messageId, updates) => {
      state = { ...state, ...updates };
      return state;
    });
    const client = makeClient();

    const [cancelResult, endResult] = await Promise.all([
      cancelGiveaway(client, 'guild-1', 'msg-1'),
      endGiveaway(client, 'guild-1', 'msg-1'),
    ]);

    // Solo una de las dos transiciones "ganó" — la otra ve ended=true y se frena.
    const succeeded = [cancelResult?.giveaway, endResult].filter(Boolean);
    expect(succeeded.length).toBe(1);
  });
});

describe('scheduleGiveawayEnd — timer en memoria', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    getGiveaway.mockResolvedValue(makeGiveaway());
    updateGiveaway.mockImplementation(async (guildId, messageId, updates) => ({ ...makeGiveaway(), ...updates }));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('no termina el sorteo antes de tiempo', async () => {
    const client = makeClient();

    scheduleGiveawayEnd(client, 'guild-1', 'msg-1', 60_000);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(updateGiveaway).not.toHaveBeenCalled();
  });

  it('termina el sorteo solo cuando se cumple el delay', async () => {
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
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('un sorteo cuyo tiempo ya venció mientras el bot estaba apagado termina de inmediato al arrancar', async () => {
    getActiveGiveaways.mockResolvedValue([{ guildId: 'guild-1', messageId: 'msg-vencido', endTimestamp: Date.now() - 5_000 }]);
    getGiveaway.mockResolvedValue(makeGiveaway({ messageId: 'msg-vencido' }));
    updateGiveaway.mockImplementation(async (guildId, messageId, updates) => ({ ...makeGiveaway({ messageId: 'msg-vencido' }), ...updates }));
    const client = makeClient();

    await rescheduleActiveGiveaways(client);

    expect(updateGiveaway).toHaveBeenCalledWith('guild-1', 'msg-vencido', expect.objectContaining({ ended: true }));
  });

  it('un sorteo que todavía no venció se reprograma, no se termina de inmediato', async () => {
    getActiveGiveaways.mockResolvedValue([{ guildId: 'guild-1', messageId: 'msg-futuro', endTimestamp: Date.now() + 60_000 }]);
    getGiveaway.mockResolvedValue(makeGiveaway({ messageId: 'msg-futuro' }));
    updateGiveaway.mockImplementation(async (guildId, messageId, updates) => ({ ...makeGiveaway({ messageId: 'msg-futuro' }), ...updates }));
    const client = makeClient();

    await rescheduleActiveGiveaways(client);
    expect(updateGiveaway).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(updateGiveaway).toHaveBeenCalledWith('guild-1', 'msg-futuro', expect.objectContaining({ ended: true }));
  });
});

describe('reconcilePendingGiveawayAnnouncements — recuperación de Caso B al arrancar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('encuentra sorteos ended sin anunciar y completa el anuncio sin recalcular ganadores', async () => {
    const stuck = makeGiveaway({ messageId: 'msg-stuck', ended: true, winners: ['user-1'], winnersAnnouncedAt: null });
    getGiveawaysPendingAnnouncement.mockResolvedValue([{ guildId: 'guild-1', messageId: 'msg-stuck' }]);
    getGiveaway.mockResolvedValue(stuck);
    updateGiveaway.mockImplementation(async (guildId, messageId, updates) => ({ ...stuck, ...updates }));
    const client = makeClient();

    await reconcilePendingGiveawayAnnouncements(client);

    expect(updateGiveaway).toHaveBeenCalledWith('guild-1', 'msg-stuck', { winnersAnnouncedAt: expect.any(Number) });
    expect(client.channel.send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('user-1') }));
  });

  it('sin sorteos pendientes, no hace nada', async () => {
    getGiveawaysPendingAnnouncement.mockResolvedValue([]);
    const client = makeClient();

    await reconcilePendingGiveawayAnnouncements(client);

    expect(getGiveaway).not.toHaveBeenCalled();
    expect(updateGiveaway).not.toHaveBeenCalled();
  });

  // Caso B (Fase 2A.1): el retry en sí puede volver a fallar (rate limit, timeout, etc.)
  // — no debe marcar winnersAnnouncedAt cuando eso pasa, para que quede pendiente y el
  // próximo tick (o restart) lo vuelva a intentar.
  it('Caso B — si el reintento vuelve a fallar, winners_announced_at sigue en null', async () => {
    const stuck = makeGiveaway({ messageId: 'msg-stuck', ended: true, winners: ['user-1'], winnersAnnouncedAt: null });
    getGiveawaysPendingAnnouncement.mockResolvedValue([{ guildId: 'guild-1', messageId: 'msg-stuck' }]);
    getGiveaway.mockResolvedValue(stuck);
    updateGiveaway.mockImplementation(async (guildId, messageId, updates) => ({ ...stuck, ...updates }));
    const client = makeClient();
    client.channel.send.mockRejectedValueOnce(new Error('rate limited'));

    await reconcilePendingGiveawayAnnouncements(client);

    // El único update que hubiera marcado "anunciado" nunca se llama — el estado queda
    // exactamente como estaba (ended=true, winnersAnnouncedAt=null).
    expect(updateGiveaway).not.toHaveBeenCalledWith('guild-1', 'msg-stuck', expect.objectContaining({ winnersAnnouncedAt: expect.any(Number) }));
  });

  // Caso E (Fase 2A.1): el retry nunca vuelve a elegir ganadores, sea cual sea el
  // resultado del intento de anuncio — los ganadores ya están persistidos desde que se
  // cerró el sorteo, reconcile solo reintenta AVISAR.
  it('Caso E — el retry nunca recalcula ganadores, ni en el intento exitoso ni en el fallido', async () => {
    const stuck = makeGiveaway({ messageId: 'msg-stuck', ended: true, winners: ['user-1', 'user-2'], winnersAnnouncedAt: null });
    getGiveawaysPendingAnnouncement.mockResolvedValue([{ guildId: 'guild-1', messageId: 'msg-stuck' }]);
    getGiveaway.mockResolvedValue(stuck);
    updateGiveaway.mockImplementation(async (guildId, messageId, updates) => ({ ...stuck, ...updates }));
    const client = makeClient();

    await reconcilePendingGiveawayAnnouncements(client);

    for (const [, , updates] of updateGiveaway.mock.calls) {
      expect(updates).not.toHaveProperty('winners');
    }
    expect(client.channel.send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('user-1') }));
    expect(client.channel.send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('user-2') }));
  });

  // Caso D (Fase 2A.1): dos pasadas de reconcile "casi simultáneas" (ej. el barrido de
  // arranque y el primer tick del loop periódico solapándose) que levantan la MISMA lista
  // de pendientes antes de que cualquiera escriba — el lock por sorteo
  // (giveaway:{guildId}:{messageId}, compartido con endGiveaway) tiene que garantizar que
  // solo una de las dos manda el anuncio de verdad.
  it('Caso D — dos reconciliaciones concurrentes sobre el mismo pendiente: un solo anuncio', async () => {
    let state = makeGiveaway({ messageId: 'msg-stuck', ended: true, winners: ['user-1'], winnersAnnouncedAt: null });
    getGiveawaysPendingAnnouncement.mockResolvedValue([{ guildId: 'guild-1', messageId: 'msg-stuck' }]);
    getGiveaway.mockImplementation(async () => state);
    updateGiveaway.mockImplementation(async (guildId, messageId, updates) => {
      state = { ...state, ...updates };
      return state;
    });
    const client = makeClient();

    await Promise.all([reconcilePendingGiveawayAnnouncements(client), reconcilePendingGiveawayAnnouncements(client)]);

    expect(client.channel.send).toHaveBeenCalledTimes(1);
  });

  // Caso C (Fase 2A.1): una vez que un pendiente ya se anunció, correr reconcile de
  // nuevo (ej. el siguiente tick del loop) con el mismo estado ya actualizado no debe
  // volver a mandar el anuncio — cubre tanto el filtro de Postgres (que ya no lo
  // devolvería) como, defensivamente, el chequeo de winnersAnnouncedAt dentro de
  // endGiveaway si algo lo pasara igual.
  it('Caso C — un segundo reconcile después de un anuncio exitoso no repite el anuncio', async () => {
    let state = makeGiveaway({ messageId: 'msg-stuck', ended: true, winners: ['user-1'], winnersAnnouncedAt: null });
    getGiveawaysPendingAnnouncement.mockResolvedValueOnce([{ guildId: 'guild-1', messageId: 'msg-stuck' }]);
    getGiveaway.mockImplementation(async () => state);
    updateGiveaway.mockImplementation(async (guildId, messageId, updates) => {
      state = { ...state, ...updates };
      return state;
    });
    const client = makeClient();

    await reconcilePendingGiveawayAnnouncements(client);
    expect(client.channel.send).toHaveBeenCalledTimes(1);

    // Segunda pasada: Postgres ya no lo devolvería (winners_announced_at dejó de ser
    // null), pero se simula igual pasándolo de nuevo para probar la defensa de
    // endGiveaway, no solo el filtro de la query.
    getGiveawaysPendingAnnouncement.mockResolvedValueOnce([{ guildId: 'guild-1', messageId: 'msg-stuck' }]);
    await reconcilePendingGiveawayAnnouncements(client);

    expect(client.channel.send).toHaveBeenCalledTimes(1); // sigue en 1, no se repitió
  });

  // Caso G (Fase 2A.1): el flujo real de arranque llama rescheduleActiveGiveaways Y
  // reconcilePendingGiveawayAnnouncements juntos (ver ready.js) — un sorteo activo de
  // verdad y un sorteo pendiente de anuncio no deben interferirse entre sí.
  it('Caso G — restart con un sorteo activo Y uno pendiente de anuncio: los dos se resuelven bien', async () => {
    const stuck = makeGiveaway({ messageId: 'msg-stuck', ended: true, winners: ['user-1'], winnersAnnouncedAt: null });
    const active = makeGiveaway({ messageId: 'msg-activo', ended: false });

    getActiveGiveaways.mockResolvedValue([{ guildId: 'guild-1', messageId: 'msg-activo', endTimestamp: Date.now() + 60_000 }]);
    getGiveawaysPendingAnnouncement.mockResolvedValue([{ guildId: 'guild-1', messageId: 'msg-stuck' }]);
    getGiveaway.mockImplementation(async (guildId, messageId) => (messageId === 'msg-stuck' ? stuck : active));
    updateGiveaway.mockImplementation(async (guildId, messageId, updates) => ({ ...(messageId === 'msg-stuck' ? stuck : active), ...updates }));
    const client = makeClient();

    await rescheduleActiveGiveaways(client);
    await reconcilePendingGiveawayAnnouncements(client);

    // El activo no se tocó (sigue sin ended).
    expect(updateGiveaway).not.toHaveBeenCalledWith('guild-1', 'msg-activo', expect.anything());
    // El pendiente sí se anunció.
    expect(updateGiveaway).toHaveBeenCalledWith('guild-1', 'msg-stuck', { winnersAnnouncedAt: expect.any(Number) });
  });
});

// startGiveawayReconcileLoop registra un único setInterval de por vida del proceso (ver
// el comentario del propio archivo) — su "guardia contra doble registro" es un flag a
// nivel de módulo, así que todo esto vive en UN SOLO test: llamarlo dos veces adentro
// del mismo test es la única forma honesta de probar la guardia sin pelearse con que
// vi.useFakeTimers()/vi.useRealTimers() de otros tests borre el interval real entre
// medio (un segundo `it()` con su propio beforeEach nunca vería el interval del primero).
describe('startGiveawayReconcileLoop — retry periódico (Fase 2A.1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    getGiveawaysPendingAnnouncement.mockResolvedValue([]);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('tiquetea cada 5 minutos; llamarlo dos veces no duplica la cadencia (guardia contra doble registro); sin pendientes no hace trabajo extra; y cuando aparece un pendiente lo anuncia sin recalcular ganadores', async () => {
    const client = makeClient();

    startGiveawayReconcileLoop(client);
    startGiveawayReconcileLoop(client); // doble registro real — si la guardia no funcionara, esto duplicaría la cadencia de abajo

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(getGiveawaysPendingAnnouncement).toHaveBeenCalledTimes(1); // con guardia rota, sería 2
    expect(getGiveaway).not.toHaveBeenCalled(); // sin pendientes, ni siquiera se lee un giveaway
    expect(updateGiveaway).not.toHaveBeenCalled();

    // Ahora aparece un pendiente antes del próximo tick.
    const stuck = makeGiveaway({ messageId: 'msg-stuck', ended: true, winners: ['user-1'], winnersAnnouncedAt: null });
    getGiveawaysPendingAnnouncement.mockResolvedValue([{ guildId: 'guild-1', messageId: 'msg-stuck' }]);
    getGiveaway.mockResolvedValue(stuck);
    updateGiveaway.mockImplementation(async (guildId, messageId, updates) => ({ ...stuck, ...updates }));

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(getGiveawaysPendingAnnouncement).toHaveBeenCalledTimes(2);
    expect(client.channel.send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('user-1') }));
    expect(updateGiveaway).toHaveBeenCalledWith('guild-1', 'msg-stuck', { winnersAnnouncedAt: expect.any(Number) });
    // Nunca se le pasó "winners" a updateGiveaway — el retry no recalculó ganadores.
    for (const [, , updates] of updateGiveaway.mock.calls) {
      expect(updates).not.toHaveProperty('winners');
    }
  });
});
