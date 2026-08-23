import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// reminderEngine.js no toca Supabase directamente (eso lo hace remindersStore.js, que
// se mockea acá) — nada de esto es un test de integración, no hay red real en ningún
// punto. Cubre lo que más importa de un sistema de timers en memoria: que sobreviva un
// "restart" (rescheduleReminders) y que el catch-up de un recordatorio vencido dispare
// al toque en vez de perderse silenciosamente.
const getAllReminders = vi.fn();
const deleteReminder = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/remindersStore.js', () => ({ getAllReminders, deleteReminder }));

const { scheduleReminder, cancelReminder, rescheduleReminders } = await import('../src/utils/reminderEngine.js');

function makeClient() {
  const send = vi.fn().mockResolvedValue(undefined);
  const user = { send };
  return { client: { users: { fetch: vi.fn().mockResolvedValue(user) } }, send };
}

function makeReminder(overrides = {}) {
  return { id: `reminder-${Math.random()}`, userId: 'user-1', message: 'tomar agua', remindAt: Date.now() + 60_000, ...overrides };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  deleteReminder.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('scheduleReminder', () => {
  it('un recordatorio ya vencido (delay <= 0) dispara el DM de inmediato', async () => {
    const { client, send } = makeClient();
    const reminder = makeReminder({ remindAt: Date.now() - 1_000 });

    scheduleReminder(client, reminder);
    await vi.advanceTimersByTimeAsync(0);

    expect(send).toHaveBeenCalledTimes(1);
    expect(deleteReminder).toHaveBeenCalledWith(reminder.id);
  });

  it('un recordatorio futuro NO dispara antes de tiempo', async () => {
    const { client, send } = makeClient();
    const reminder = makeReminder({ remindAt: Date.now() + 60_000 });

    scheduleReminder(client, reminder);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(send).not.toHaveBeenCalled();
  });

  it('dispara justo al cumplirse el tiempo, con el mensaje correcto', async () => {
    const { client, send } = makeClient();
    const reminder = makeReminder({ remindAt: Date.now() + 60_000, message: 'sacar la basura' });

    scheduleReminder(client, reminder);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(send).toHaveBeenCalledTimes(1);
    const embed = send.mock.calls[0][0].embeds[0];
    expect(embed.data.description).toBe('sacar la basura');
    expect(deleteReminder).toHaveBeenCalledWith(reminder.id);
  });
});

describe('cancelReminder', () => {
  it('cancelar antes de que dispare evita el DM y el borrado', async () => {
    const { client, send } = makeClient();
    const reminder = makeReminder({ remindAt: Date.now() + 60_000 });

    scheduleReminder(client, reminder);
    cancelReminder(reminder.id);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(send).not.toHaveBeenCalled();
    expect(deleteReminder).not.toHaveBeenCalled();
  });

  it('cancelar un recordatorio que no existe (o ya disparó) no revienta', () => {
    expect(() => cancelReminder('id-inexistente')).not.toThrow();
  });
});

describe('rescheduleReminders — reprogramar al iniciar, con catch-up', () => {
  it('reprograma varios recordatorios guardados: el vencido dispara ya, el futuro espera', async () => {
    const { client, send } = makeClient();
    const vencido = makeReminder({ id: 'r-vencido', remindAt: Date.now() - 5_000 });
    const futuro = makeReminder({ id: 'r-futuro', remindAt: Date.now() + 60_000 });
    getAllReminders.mockResolvedValue([vencido, futuro]);

    await rescheduleReminders(client);
    await vi.advanceTimersByTimeAsync(0);

    expect(send).toHaveBeenCalledTimes(1); // solo el vencido, todavía
    expect(deleteReminder).toHaveBeenCalledWith('r-vencido');
    expect(deleteReminder).not.toHaveBeenCalledWith('r-futuro');

    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(2); // ahora también el futuro
    expect(deleteReminder).toHaveBeenCalledWith('r-futuro');
  });

  it('sin recordatorios guardados, no programa nada', async () => {
    const { client, send } = makeClient();
    getAllReminders.mockResolvedValue([]);

    await rescheduleReminders(client);
    await vi.advanceTimersByTimeAsync(120_000);

    expect(send).not.toHaveBeenCalled();
  });
});
