import { vi, describe, it, expect, beforeEach } from 'vitest';

// Plan de ejecución post-auditoría (2026-09-12), Fase 2: /recordatorio crear leía
// getUserActiveReminderCount y recién después escribía con createReminder, sin ningún
// lock — dos "crear" casi simultáneos del mismo usuario podían los dos leer el mismo
// conteo por debajo de REMINDER_LIMIT_PER_USER antes de que ninguno hubiera escrito, y
// terminar los dos creando (superando el límite). Mismo patrón que tests/give.test.js:
// lock real de asyncLock.js (nunca mockeado), Promise.all sin await entre sí.
let currentCount = 0;
const getUserActiveReminderCount = vi.fn(async () => currentCount);
const createReminder = vi.fn(async (guildId, userId, message, remindAt, repeatMs) => {
  currentCount += 1;
  return { id: currentCount, guildId, userId, message, remindAt, repeatMs };
});
const getUserReminders = vi.fn().mockResolvedValue([]);
const deleteReminder = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/remindersStore.js', () => ({
  createReminder: (...a) => createReminder(...a),
  getUserReminders: (...a) => getUserReminders(...a),
  deleteReminder: (...a) => deleteReminder(...a),
  getUserActiveReminderCount: (...a) => getUserActiveReminderCount(...a),
}));

const scheduleReminder = vi.fn();
const cancelReminder = vi.fn();
vi.mock('../src/utils/reminderEngine.js', () => ({
  scheduleReminder: (...a) => scheduleReminder(...a),
  cancelReminder: (...a) => cancelReminder(...a),
}));

const { execute } = await import('../src/commands/utilidad/recordatorio.js');

function makeCrearInteraction({ guildId = 'guild-1', userId = 'user-1', tiempo = '10m', mensaje = 'algo' } = {}) {
  return {
    guildId,
    client: {},
    user: { id: userId },
    options: {
      getSubcommand: () => 'crear',
      getString: (name) => ({ tiempo, mensaje, repetir: null })[name] ?? null,
    },
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  currentCount = 0;
});

describe('/recordatorio crear — límite por usuario', () => {
  it('por debajo del límite: crea normalmente', async () => {
    const interaction = makeCrearInteraction({ userId: 'rec-1' });
    await execute(interaction);

    expect(createReminder).toHaveBeenCalledTimes(1);
    expect(scheduleReminder).toHaveBeenCalledTimes(1);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Listo') }));
  });

  it('en el límite (10 activos): rechaza sin crear', async () => {
    currentCount = 10;
    const interaction = makeCrearInteraction({ userId: 'rec-2' });
    await execute(interaction);

    expect(createReminder).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Ya tenés 10 recordatorios activos') }));
  });
});

// Auditoría completa NEXO (2026-09-11), hallazgo H2 — cierre en el plan de ejecución
// post-auditoría (Fase 2, 2026-09-12).
describe('/recordatorio crear — concurrencia real (lock real de asyncLock.js)', () => {
  it('mismo usuario en el límite -1, dos "crear" sin await entre sí: solo uno pasa', async () => {
    currentCount = 9; // exactamente uno más entra dentro del límite de 10
    const first = makeCrearInteraction({ userId: 'rec-race-1' });
    const second = makeCrearInteraction({ userId: 'rec-race-1' });

    await Promise.all([execute(first), execute(second)]);

    expect(createReminder).toHaveBeenCalledTimes(1);

    const rejections = [first, second].filter((i) =>
      i.reply.mock.calls.some((call) => call[0]?.content?.includes('Ya tenés 10 recordatorios activos')),
    );
    expect(rejections).toHaveLength(1);
  });

  it('usuarios DISTINTOS disparados sin await entre sí: no se bloquean entre ellos, los dos crean', async () => {
    currentCount = 9;
    const a = makeCrearInteraction({ userId: 'rec-race-a' });
    const b = makeCrearInteraction({ userId: 'rec-race-b' });

    await Promise.all([execute(a), execute(b)]);

    expect(createReminder).toHaveBeenCalledTimes(2);
  });
});
