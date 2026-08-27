import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// reminderEngine.js no toca Supabase directamente (eso lo hace remindersStore.js, que
// se mockea acá) — nada de esto es un test de integración, no hay red real en ningún
// punto. Cubre lo que más importa de un sistema de timers en memoria: que sobreviva un
// "restart" (rescheduleReminders) y que el catch-up de un recordatorio vencido dispare
// al toque en vez de perderse silenciosamente.
const getAllReminders = vi.fn();
const deleteReminder = vi.fn().mockResolvedValue(undefined);
const rescheduleReminder = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/remindersStore.js', () => ({ getAllReminders, deleteReminder, rescheduleReminder }));

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
  rescheduleReminder.mockResolvedValue(undefined);
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

describe('recordatorios recurrentes', () => {
  it('con repeatMs, se reprograma en vez de borrarse al disparar', async () => {
    const { client, send } = makeClient();
    const reminder = makeReminder({ id: 'r-diario', remindAt: Date.now() + 60_000, repeatMs: 86_400_000 });

    scheduleReminder(client, reminder);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(send).toHaveBeenCalledTimes(1);
    expect(deleteReminder).not.toHaveBeenCalled();
    expect(rescheduleReminder).toHaveBeenCalledWith('r-diario', expect.any(Number));

    // Debería volver a disparar ~1 día después, sin que nadie lo vuelva a crear.
    await vi.advanceTimersByTimeAsync(86_400_000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('sin repeatMs (el caso de siempre), se borra como antes', async () => {
    const { client, send } = makeClient();
    const reminder = makeReminder({ remindAt: Date.now() + 60_000 });

    scheduleReminder(client, reminder);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(send).toHaveBeenCalledTimes(1);
    expect(deleteReminder).toHaveBeenCalledWith(reminder.id);
    expect(rescheduleReminder).not.toHaveBeenCalled();
  });
});

describe('scheduleReminder — reschedule no deja timers fantasma (auditoría 2026-08-27)', () => {
  it('reprogramar el mismo id antes de que dispare cancela el timer viejo (no dispara dos veces)', async () => {
    const { client, send } = makeClient();
    const reminder = makeReminder({ id: 'r-1', remindAt: Date.now() + 60_000 });

    scheduleReminder(client, reminder);
    // Se reprograma para más tarde ANTES de que el primer timer llegue a disparar —
    // sin el fix, el handle viejo queda vivo y también dispara en su horario original.
    const reprogramado = { ...reminder, remindAt: Date.now() + 120_000 };
    scheduleReminder(client, reprogramado);

    await vi.advanceTimersByTimeAsync(60_000); // horario del timer VIEJO
    expect(send).not.toHaveBeenCalled(); // si el leak existiera, ya habría disparado acá

    await vi.advanceTimersByTimeAsync(60_000); // horario del timer NUEVO (total 120s)
    expect(send).toHaveBeenCalledTimes(1); // dispara UNA sola vez, no dos
  });

  it('reprogramar un id que no tenía timer activo no revienta', () => {
    const { client } = makeClient();
    expect(() => scheduleReminder(client, makeReminder({ id: 'r-nuevo' }))).not.toThrow();
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
