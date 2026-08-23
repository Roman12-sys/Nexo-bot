import { vi, describe, it, expect, beforeEach } from 'vitest';

// /guess no tenía ningún tope — con búsqueda binaria óptima (~7 intentos para adivinar
// entre 1 y 100) se podía cobrar moneda garantizada indefinidamente, sin cooldown como sí
// tienen /daily, /work y /trivia. Esto prueba el tope de partidas NUEVAS por día.
const addBalance = vi.fn().mockResolvedValue(100);
vi.mock('../src/utils/economyStore.js', () => ({ addBalance }));

const unlockAchievement = vi.fn().mockResolvedValue(null);
const announceUnlockedAchievements = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/achievements.js', () => ({ unlockAchievement, announceUnlockedAchievements }));

// guessSessions.js y asyncLock.js son reales — ninguno de los dos toca Supabase, son
// puro estado en memoria (mismo motivo por el que no hace falta mockearlos).
const { execute } = await import('../src/commands/diversion/guess.js');
const { clearSession } = await import('../src/utils/guessSessions.js');

function makeInteraction({ userId = 'user-1', numero = 50 } = {}) {
  return {
    guild: { id: 'guild-1' },
    user: { id: userId },
    options: { getInteger: () => numero },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

// Fuerza que la partida termine ya (evita depender de adivinar al azar): prueba con
// todos los números hasta que acierta, así el test no es un juego de azar en sí mismo.
async function playUntilWin(userId) {
  for (let n = 1; n <= 100; n++) {
    const interaction = makeInteraction({ userId, numero: n });
    await execute(interaction);
    const replied = interaction.reply.mock.calls[0]?.[0]?.content || '';
    if (replied.includes('Correcto') || interaction.editReply.mock.calls[0]?.[0]?.content?.includes('Correcto')) return;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  addBalance.mockResolvedValue(100);
});

describe('/guess — tope diario de partidas nuevas', () => {
  it('permite hasta 5 partidas nuevas por día, la 6ta queda bloqueada', async () => {
    const userId = `user-${Math.random()}`;

    for (let i = 0; i < 5; i++) {
      await playUntilWin(userId);
    }
    // 5 partidas ganadas = 5 addBalance exitosos.
    expect(addBalance).toHaveBeenCalledTimes(5);

    // La 6ta ni siquiera debería arrancar una sesión nueva — se rechaza antes.
    addBalance.mockClear();
    const blockedInteraction = makeInteraction({ userId, numero: 1 });
    await execute(blockedInteraction);

    expect(blockedInteraction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Ya jugaste 5 partidas nuevas') }),
    );
    expect(addBalance).not.toHaveBeenCalled();
  });

  it('usuarios distintos no comparten el tope', async () => {
    const userA = `user-a-${Math.random()}`;
    const userB = `user-b-${Math.random()}`;

    for (let i = 0; i < 5; i++) await playUntilWin(userA);
    addBalance.mockClear();

    await playUntilWin(userB);
    expect(addBalance).toHaveBeenCalledTimes(1); // userB no está bloqueado por lo que hizo userA
  });

  it('seguir intentando una partida YA iniciada no cuenta como partida nueva', async () => {
    const userId = `user-${Math.random()}`;
    clearSession(`guild-1:${userId}`);

    // Math.random() fijo → el secreto siempre es 100, así los intentos con 1/2/3 fallan
    // de forma determinística (nada de depender de la suerte para que el test no sea flaky).
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    try {
      await execute(makeInteraction({ userId, numero: 1 })); // arranca la partida (1 "nueva"), falla
      await execute(makeInteraction({ userId, numero: 2 })); // misma partida en curso, falla
      await execute(makeInteraction({ userId, numero: 3 })); // misma partida en curso, falla
      expect(addBalance).not.toHaveBeenCalled();

      await execute(makeInteraction({ userId, numero: 100 })); // acierta, cierra ESA partida
      expect(addBalance).toHaveBeenCalledTimes(1);
    } finally {
      randomSpy.mockRestore();
    }

    // Repetir el ciclo completo 4 veces más (5 en total) no debería estar bloqueado —
    // cada uno es una partida nueva distinta, dentro del tope de 5.
    for (let i = 0; i < 4; i++) await playUntilWin(userId);
    expect(addBalance).toHaveBeenCalledTimes(5);
  });
});
