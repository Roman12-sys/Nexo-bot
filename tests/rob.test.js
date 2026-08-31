import { vi, describe, it, expect, beforeEach } from 'vitest';

// FASE 1 (auditoría de seguridad/economía, 2026-08-30) — /rob leía el cooldown del
// atacante y la protección de la víctima ANTES de entrar en withLock, pero nunca los
// revalidaba adentro: el lock (keyed por atacante) serializa la ejecución, pero sin un
// chequeo "en fresco" dentro, la segunda ejecución en cola simplemente esperaba su turno
// y robaba de nuevo, ignorando el cooldown/protección que la primera ejecución ya había
// dejado escrito. Este test simula dos /rob casi simultáneos (mismo atacante, misma
// víctima) contra un estado compartido mutable (un "fake DB" en memoria, no Supabase
// real) y prueba que solo uno de los dos puede completar el robo.
const state = {
  economy: new Map(), // `${guildId}:${userId}` -> record mutable
};

function key(guildId, userId) {
  return `${guildId}:${userId}`;
}

function ensure(guildId, userId) {
  const k = key(guildId, userId);
  if (!state.economy.has(k)) {
    state.economy.set(k, { balance: 0, lastRob: 0, lastRobbed: 0, robShieldUntil: 0 });
  }
  return state.economy.get(k);
}

const getUserEconomy = vi.fn(async (guildId, userId) => ({ ...ensure(guildId, userId) }));

// setRobCooldowns real (no mock de red): pisa el estado compartido, igual que la RPC
// atómica set_rob_cooldowns lo haría en Postgres — es la escritura que la segunda
// ejecución en cola tiene que ver reflejada al releer.
const setRobCooldowns = vi.fn(async (guildId, { robberId, robberTimestamp, victimId, victimTimestamp }) => {
  ensure(guildId, robberId).lastRob = robberTimestamp;
  ensure(guildId, victimId).lastRobbed = victimTimestamp;
});

// robWallet: simula rob_wallet — resta del wallet de la víctima y suma al del atacante,
// atómico dentro de esta función (nadie más toca `state` en el medio, mismo criterio que
// la RPC real corriendo en una sola transacción de Postgres).
const robWallet = vi.fn(async (guildId, robberId, victimId, percent, maxAmount) => {
  const victim = ensure(guildId, victimId);
  const robber = ensure(guildId, robberId);
  if (victim.balance <= 0) {
    const err = new Error('nothing_to_steal');
    err.code = 'nothing_to_steal';
    throw err;
  }
  const stolen = Math.min(maxAmount, Math.floor(victim.balance * percent));
  victim.balance -= stolen;
  robber.balance += stolen;
  return { stolen, robberBalance: robber.balance, victimBalance: victim.balance };
});

const transferBalance = vi.fn(async (guildId, senderId, receiverId, amount) => {
  const sender = ensure(guildId, senderId);
  const receiver = ensure(guildId, receiverId);
  sender.balance -= amount;
  receiver.balance += amount;
  return { senderBalance: sender.balance, receiverBalance: receiver.balance };
});

const recordTransaction = vi.fn().mockResolvedValue(undefined);

vi.mock('../src/utils/economyStore.js', () => ({
  getUserEconomy,
  setRobCooldowns,
  robWallet,
  transferBalance,
  recordTransaction,
}));

// asyncLock.js se deja real: es justo la pieza que se está probando (junto con la
// revalidación en fresco dentro del lock), no tiene sentido mockearla.
const { execute } = await import('../src/commands/economia/rob.js');

function makeInteraction({ userId = 'robber-1', targetUser = { id: 'victim-1', tag: 'victim-1#0001', bot: false } } = {}) {
  return {
    guild: { id: 'guild-1' },
    user: { id: userId, tag: `${userId}#0001` },
    options: { getUser: () => targetUser },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.economy.clear();
});

describe('/rob — cierre de la race condition de cooldown/protección', () => {
  it('dos /rob casi simultáneos del mismo atacante contra la misma víctima: solo uno completa el robo', async () => {
    ensure('guild-1', 'victim-1').balance = 10_000; // bien por encima de MIN_VICTIM_WALLET

    // Fuerza siempre "éxito" (SUCCESS_CHANCE=0.4) para que, si el bug existiera, las DOS
    // ejecuciones robaran de verdad en vez de que la segunda caiga en la rama de multa.
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.01);
    try {
      const interactionA = makeInteraction();
      const interactionB = makeInteraction();

      // "Casi simultáneas": arrancan las dos antes de que ninguna haya terminado — el
      // pre-check (fuera del lock) de ambas lee el mismo estado viejo (lastRob=0).
      await Promise.all([execute(interactionA), execute(interactionB)]);

      // robWallet (la RPC atómica) solo se llamó una vez — la otra ejecución tuvo que
      // haber sido rechazada por la revalidación DENTRO del lock antes de llegar ahí.
      expect(robWallet).toHaveBeenCalledTimes(1);

      // El texto de "éxito" solo aparece en UNA de las dos respuestas finales.
      const replies = [...interactionA.editReply.mock.calls, ...interactionB.editReply.mock.calls].map(
        (call) => call[0]?.embeds?.[0]?.data?.title || call[0]?.content || '',
      );
      const successCount = replies.filter((r) => r.includes('¡Robo exitoso!')).length;
      const blockedCount = replies.filter((r) => r.includes('escondiéndote') || r.includes('protegido')).length;
      expect(successCount).toBe(1);
      expect(blockedCount).toBe(1);

      // Estado final consistente: el atacante tiene EXACTAMENTE lo robado una vez, no el
      // doble, y la víctima perdió exactamente eso una vez.
      const finalRobber = ensure('guild-1', 'robber-1');
      const finalVictim = ensure('guild-1', 'victim-1');
      expect(finalRobber.balance + finalVictim.balance).toBe(10_000); // nada se creó ni se perdió de más
      expect(finalRobber.balance).toBeGreaterThan(0);

      // Cooldown del atacante y protección de la víctima quedaron fijados una sola vez
      // con el mismo timestamp (la RPC atómica real correría igual) — nunca dos
      // recompensas de robo.
      expect(setRobCooldowns).toHaveBeenCalledTimes(1);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('sin la carrera: un segundo /rob normal (no concurrente) sigue bloqueado por cooldown, como antes', async () => {
    ensure('guild-1', 'victim-1').balance = 10_000;
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.01);
    try {
      await execute(makeInteraction());
      expect(robWallet).toHaveBeenCalledTimes(1);

      robWallet.mockClear();
      const second = makeInteraction();
      await execute(second);

      expect(robWallet).not.toHaveBeenCalled();
      expect(second.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('escondiéndote') }),
      );
    } finally {
      randomSpy.mockRestore();
    }
  });
});
