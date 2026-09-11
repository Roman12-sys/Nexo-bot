import { vi, describe, it, expect, beforeEach } from 'vitest';

// Auditoría completa NEXO (2026-09-11): /trivia (preguntas/cooldown/puntaje/premio) no
// tenía NINGÚN test propio pese a cruzar 3 sistemas a la vez (puntos propios, economía,
// XP). guessSessions.js y asyncLock.js se usan REALES (son puros, en memoria, sin
// Supabase) — así se ejercita el flujo real de "mostrar pregunta -> responder", no una
// versión simulada de esa lógica.
const TRIVIA_QUESTIONS = [
  { id: 'q1', question: '¿2+2?', options: ['3', '4', '5', '6'], correct: 1, difficulty: 'facil' },
  { id: 'q2', question: '¿Capital de Francia?', options: ['Roma', 'Madrid', 'París', 'Berlín'], correct: 2, difficulty: 'facil' },
];
vi.mock('../src/utils/triviaQuestions.js', () => ({ default: TRIVIA_QUESTIONS }));

const getPlayStatus = vi.fn();
const registerPlay = vi.fn().mockResolvedValue(undefined);
const pickQuestionForUser = vi.fn();
const getUserTrivia = vi.fn().mockResolvedValue({ answeredQuestionIds: [] });
const recordAnswer = vi.fn();
const getGuildTrivia = vi.fn().mockResolvedValue([]);
vi.mock('../src/utils/triviaStore.js', () => ({
  pickQuestionForUser: (...a) => pickQuestionForUser(...a),
  getGuildTrivia: (...a) => getGuildTrivia(...a),
  getPlayStatus: (...a) => getPlayStatus(...a),
  registerPlay: (...a) => registerPlay(...a),
  recordAnswer: (...a) => recordAnswer(...a),
  getUserTrivia: (...a) => getUserTrivia(...a),
  MAX_PLAYS_PER_WINDOW: 3,
  POINTS_PER_CORRECT: 10,
}));

const emit = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/eventBus.js', () => ({ eventBus: { emit: (...a) => emit(...a) } }));

const addBalance = vi.fn().mockResolvedValue(500);
vi.mock('../src/utils/economyStore.js', () => ({ addBalance: (...a) => addBalance(...a) }));

const addXp = vi.fn().mockResolvedValue({ leveledUp: false });
vi.mock('../src/utils/xpStore.js', () => ({ addXp: (...a) => addXp(...a) }));

const processLevelUp = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/xpEngine.js', () => ({ processLevelUp: (...a) => processLevelUp(...a) }));

const getGuildConfig = vi.fn().mockResolvedValue({ features: { xp: true } });
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig: (...a) => getGuildConfig(...a) }));

const { execute } = await import('../src/commands/diversion/trivia.js');
const { routeButton } = await import('../src/components/buttons.js');
const { clearSession } = await import('../src/utils/guessSessions.js');

function makeJugarInteraction({ guildId = 'guild-1', userId = 'user-1', dificultad = null } = {}) {
  return {
    guild: { id: guildId },
    user: { id: userId },
    options: { getSubcommand: () => 'jugar', getString: (name) => (name === 'dificultad' ? dificultad : null) },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

function extractCustomIds(interaction) {
  return interaction.editReply.mock.calls[0][0].components[0].components.map((b) => b.data.custom_id);
}

beforeEach(() => {
  vi.clearAllMocks();
  clearSession('trivia:guild-1:user-1'); // las sesiones son un Map module-level real, no se resetean solas entre tests
  getPlayStatus.mockResolvedValue({ allowed: true, remaining: 2, resetAt: Date.now() + 1000 });
  pickQuestionForUser.mockResolvedValue({ question: TRIVIA_QUESTIONS[0], historyReset: false });
  getUserTrivia.mockResolvedValue({ answeredQuestionIds: [] });
  getGuildConfig.mockResolvedValue({ features: { xp: true } });
});

describe('/trivia jugar', () => {
  it('sin cooldown disponible: avisa cuándo puede volver, nunca llega a pickQuestionForUser', async () => {
    getPlayStatus.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 3600_000 });
    const interaction = makeJugarInteraction();

    await execute(interaction);

    expect(registerPlay).not.toHaveBeenCalled();
    expect(pickQuestionForUser).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Ya jugaste') }));
  });

  it('caso exitoso: registra el intento y muestra la pregunta con un botón por opción', async () => {
    const interaction = makeJugarInteraction();

    await execute(interaction);

    expect(registerPlay).toHaveBeenCalledWith('guild-1', 'user-1');
    const customIds = extractCustomIds(interaction);
    expect(customIds).toHaveLength(4);
    expect(customIds[0]).toBe('trivia_user-1_q1_0');
  });

  it('ya hay una pregunta pendiente: rechaza sin gastar un intento nuevo', async () => {
    const first = makeJugarInteraction();
    await execute(first);
    expect(registerPlay).toHaveBeenCalledTimes(1);

    const second = makeJugarInteraction();
    await execute(second);

    expect(registerPlay).toHaveBeenCalledTimes(1); // no un segundo intento
    expect(second.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('sin responder') }));
  });

  it('filtra por dificultad cuando se especifica', async () => {
    const interaction = makeJugarInteraction({ dificultad: 'facil' });
    await execute(interaction);

    const [, , pool] = pickQuestionForUser.mock.calls[0];
    expect(pool.every((q) => q.difficulty === 'facil')).toBe(true);
  });
});

describe('/trivia — responder (botón)', () => {
  async function playAndAnswer({ clickedIndex, byUserId = 'user-1', asUserId = 'user-1', xpEnabled = true } = {}) {
    getGuildConfig.mockResolvedValue({ features: { xp: xpEnabled } });
    const jugar = makeJugarInteraction({ userId: byUserId });
    await execute(jugar);

    const buttonInteraction = {
      guild: { id: 'guild-1' },
      user: { id: asUserId },
      member: {},
      client: {},
      customId: `trivia_${byUserId}_q1_${clickedIndex}`,
      update: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    };
    await routeButton(buttonInteraction);
    return buttonInteraction;
  }

  it('otro usuario que no inició la trivia clickea: rechazo ephemeral, la sesión sigue viva', async () => {
    const jugar = makeJugarInteraction({ userId: 'user-1' });
    await execute(jugar);

    const intruder = {
      guild: { id: 'guild-1' },
      user: { id: 'user-intruso' },
      customId: 'trivia_user-1_q1_1',
      reply: vi.fn().mockResolvedValue(undefined),
    };
    await routeButton(intruder);

    expect(intruder.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('no es tuya') }));
    expect(recordAnswer).not.toHaveBeenCalled();
  });

  it('sesión expirada/inexistente: avisa que ya venció, no revienta', async () => {
    const stale = {
      guild: { id: 'guild-1' },
      user: { id: 'user-1' },
      customId: 'trivia_user-1_q1_1',
      update: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    };

    await routeButton(stale);

    expect(stale.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('expiró') }));
    expect(recordAnswer).not.toHaveBeenCalled();
  });

  it('respuesta correcta (XP activado): acredita monedas y XP, y felicita', async () => {
    recordAnswer.mockResolvedValue({ points: 30, correct: 3, answered: 5 });

    const buttonInteraction = await playAndAnswer({ clickedIndex: 1, xpEnabled: true });

    expect(recordAnswer).toHaveBeenCalledWith('guild-1', 'user-1', 'q1', true);
    expect(addBalance).toHaveBeenCalledWith('guild-1', 'user-1', expect.any(Number), expect.objectContaining({ type: 'trivia' }));
    expect(addXp).toHaveBeenCalledWith('guild-1', 'user-1', expect.any(Number), { source: 'trivia' });
    expect(emit).toHaveBeenCalledWith('TRIVIA_CORRECT', expect.objectContaining({ guildId: 'guild-1', userId: 'user-1' }));
    expect(buttonInteraction.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('¡Correcto!') }));
  });

  it('respuesta correcta (XP desactivado): acredita monedas, NUNCA llama a addXp', async () => {
    recordAnswer.mockResolvedValue({ points: 10, correct: 1, answered: 1 });

    await playAndAnswer({ clickedIndex: 1, xpEnabled: false });

    expect(addBalance).toHaveBeenCalled();
    expect(addXp).not.toHaveBeenCalled();
  });

  it('respuesta incorrecta: no acredita nada, muestra la opción correcta', async () => {
    recordAnswer.mockResolvedValue({ points: 10, correct: 1, answered: 2 });

    const buttonInteraction = await playAndAnswer({ clickedIndex: 0 }); // la correcta de q1 es el índice 1

    expect(recordAnswer).toHaveBeenCalledWith('guild-1', 'user-1', 'q1', false);
    expect(addBalance).not.toHaveBeenCalled();
    expect(addXp).not.toHaveBeenCalled();
    expect(buttonInteraction.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Incorrecto') }));
  });

  it('subió de nivel al responder: procesa el level-up', async () => {
    recordAnswer.mockResolvedValue({ points: 10, correct: 1, answered: 1 });
    addXp.mockResolvedValue({ leveledUp: true, previousLevel: 4, newLevel: 5, record: { xp: 1000 } });

    await playAndAnswer({ clickedIndex: 1 });

    expect(processLevelUp).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ previousLevel: 4, newLevel: 5, totalXp: 1000 }),
      expect.anything(),
    );
  });

  it('10 respuestas correctas acumuladas: dispara el chequeo de logro', async () => {
    recordAnswer.mockResolvedValue({ points: 100, correct: 10, answered: 12 });

    await playAndAnswer({ clickedIndex: 1 });

    expect(emit).toHaveBeenCalledWith('ACHIEVEMENT_CHECK', expect.objectContaining({ achievementId: 'sabelotodo' }));
  });

  it('9 respuestas correctas (todavía no llega a 10): NO dispara el logro', async () => {
    recordAnswer.mockResolvedValue({ points: 90, correct: 9, answered: 10 });

    await playAndAnswer({ clickedIndex: 1 });

    expect(emit).not.toHaveBeenCalledWith('ACHIEVEMENT_CHECK', expect.anything());
  });

  it('la sesión se limpia después de responder — un segundo click con el mismo customId ya no cuenta', async () => {
    recordAnswer.mockResolvedValue({ points: 10, correct: 1, answered: 1 });
    const first = await playAndAnswer({ clickedIndex: 1 });

    const secondClick = {
      guild: { id: 'guild-1' },
      user: { id: 'user-1' },
      customId: 'trivia_user-1_q1_1',
      update: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    };
    await routeButton(secondClick);

    expect(recordAnswer).toHaveBeenCalledTimes(1); // no una segunda vez
    expect(secondClick.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('expiró') }));
  });
});
