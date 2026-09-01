import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// punishEngine.js (auditoría 2026-08-29, Parte 22) mirrors exactamente el patrón de
// reminderEngine.js: mismo split store/engine, mismos timers en memoria, mismo
// catch-up al reiniciar. Fase A (segunda auditoría, 2026-08-30) lo dejó sin test propio
// pese a tocar dinero de nadie pero sí acciones reales de moderación (quitar un rol) —
// lo que más importa proteger es que expire exactamente una vez y que sobreviva un
// "restart" (rescheduleActivePunishments) sin duplicar el timer.
const getGuildLogChannel = vi.fn().mockResolvedValue(null);
vi.mock('../src/utils/guildLogChannels.js', () => ({ getGuildLogChannel }));

const createPunishLogEmbed = vi.fn(() => ({}));
vi.mock('../src/utils/logEmbeds.js', () => ({ createPunishLogEmbed }));

const recordModerationAction = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/moderationActionsStore.js', () => ({ recordModerationAction }));

const getAllActivePunishments = vi.fn();
const deleteActivePunishment = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/punishStore.js', () => ({ getAllActivePunishments, deleteActivePunishment }));

const { schedulePunishExpiry, cancelPunishExpiry, rescheduleActivePunishments, revokePunishment } = await import('../src/utils/punishEngine.js');

function makeClient({ hasRole = true } = {}) {
  const rolesRemove = vi.fn().mockResolvedValue(undefined);
  const member = {
    roles: { cache: { has: () => hasRole }, remove: rolesRemove },
    user: { id: 'target-1', tag: 'target-1#0001' },
  };
  const guild = { members: { fetch: vi.fn().mockResolvedValue(member) } };
  const client = {
    guilds: { fetch: vi.fn().mockResolvedValue(guild) },
    users: { fetch: vi.fn().mockResolvedValue(member.user) },
    user: { id: 'bot-1' },
  };
  return { client, rolesRemove };
}

function makePunishment(overrides = {}) {
  return { guildId: 'guild-1', userId: 'target-1', roleId: 'role-sancionado', expiresAt: Date.now() + 60_000, ...overrides };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  deleteActivePunishment.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('schedulePunishExpiry', () => {
  it('no quita el rol antes de tiempo', async () => {
    const { client, rolesRemove } = makeClient();
    schedulePunishExpiry(client, makePunishment({ expiresAt: Date.now() + 60_000 }));

    await vi.advanceTimersByTimeAsync(30_000);
    expect(rolesRemove).not.toHaveBeenCalled();
  });

  it('al cumplirse la duración, quita el rol y borra la fila', async () => {
    const { client, rolesRemove } = makeClient();
    schedulePunishExpiry(client, makePunishment({ expiresAt: Date.now() + 60_000 }));

    await vi.advanceTimersByTimeAsync(60_000);
    expect(rolesRemove).toHaveBeenCalledWith('role-sancionado', expect.any(String));
    expect(deleteActivePunishment).toHaveBeenCalledWith('guild-1', 'target-1');
  });

  it('una duración ya vencida (delay <= 0) expira de inmediato', async () => {
    const { client, rolesRemove } = makeClient();
    schedulePunishExpiry(client, makePunishment({ expiresAt: Date.now() - 1_000 }));

    await vi.advanceTimersByTimeAsync(0);
    expect(rolesRemove).toHaveBeenCalledTimes(1);
  });

  it('si el miembro ya no tiene el rol (sacado a mano), no llama a remove pero igual limpia la fila', async () => {
    const { client, rolesRemove } = makeClient({ hasRole: false });
    schedulePunishExpiry(client, makePunishment({ expiresAt: Date.now() + 10_000 }));

    await vi.advanceTimersByTimeAsync(10_000);
    expect(rolesRemove).not.toHaveBeenCalled();
    expect(deleteActivePunishment).toHaveBeenCalledWith('guild-1', 'target-1');
  });

  it('reprogramar el mismo usuario antes de que expire cancela el timer viejo (no expira dos veces)', async () => {
    const { client, rolesRemove } = makeClient();
    schedulePunishExpiry(client, makePunishment({ expiresAt: Date.now() + 60_000 }));
    schedulePunishExpiry(client, makePunishment({ expiresAt: Date.now() + 120_000 }));

    await vi.advanceTimersByTimeAsync(60_000);
    expect(rolesRemove).not.toHaveBeenCalled(); // el timer viejo fue cancelado

    await vi.advanceTimersByTimeAsync(60_000);
    expect(rolesRemove).toHaveBeenCalledTimes(1); // el nuevo sí dispara, una sola vez
  });
});

describe('cancelPunishExpiry', () => {
  it('cancelar antes de que expire evita que se quite el rol', async () => {
    const { client, rolesRemove } = makeClient();
    schedulePunishExpiry(client, makePunishment({ expiresAt: Date.now() + 60_000 }));

    cancelPunishExpiry('guild-1', 'target-1');
    await vi.advanceTimersByTimeAsync(60_000);

    expect(rolesRemove).not.toHaveBeenCalled();
    expect(deleteActivePunishment).not.toHaveBeenCalled();
  });

  it('cancelar un usuario sin timer activo no revienta', () => {
    expect(() => cancelPunishExpiry('guild-1', 'nadie')).not.toThrow();
  });
});

// Multi-guild (Fase 2A, 2026-08-31) — activeTimeouts está keyeado por
// `${guildId}:${userId}`, pero eso solo protege si de verdad se usan los dos campos en
// cada key. El MISMO userId con una restricción activa en dos guilds distintos a la vez
// es el caso real que puede pasar en producción (un usuario problemático en varios
// servidores donde el bot está) — nunca debería mezclarse.
describe('multi-guild — el mismo userId en dos guilds nunca se mezcla', () => {
  it('cancelar la restricción en guild-a no cancela la de guild-b para el mismo usuario', async () => {
    const { client: clientA, rolesRemove: removeA } = makeClient();
    const { client: clientB, rolesRemove: removeB } = makeClient();

    schedulePunishExpiry(clientA, makePunishment({ guildId: 'guild-a', userId: 'user-123', expiresAt: Date.now() + 60_000 }));
    schedulePunishExpiry(clientB, makePunishment({ guildId: 'guild-b', userId: 'user-123', expiresAt: Date.now() + 60_000 }));

    cancelPunishExpiry('guild-a', 'user-123');
    await vi.advanceTimersByTimeAsync(60_000);

    expect(removeA).not.toHaveBeenCalled(); // cancelado
    expect(removeB).toHaveBeenCalledTimes(1); // guild-b nunca se tocó, expira normal
    expect(deleteActivePunishment).toHaveBeenCalledWith('guild-b', 'user-123');
    expect(deleteActivePunishment).not.toHaveBeenCalledWith('guild-a', 'user-123');
  });

  it('reprogramar al reiniciar con el mismo userId en dos guilds programa dos timers independientes', async () => {
    const { client, rolesRemove } = makeClient();
    getAllActivePunishments.mockResolvedValue([
      makePunishment({ guildId: 'guild-a', userId: 'user-123', expiresAt: Date.now() + 30_000 }),
      makePunishment({ guildId: 'guild-b', userId: 'user-123', expiresAt: Date.now() + 90_000 }),
    ]);

    await rescheduleActivePunishments(client);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(deleteActivePunishment).toHaveBeenCalledWith('guild-a', 'user-123');
    expect(deleteActivePunishment).not.toHaveBeenCalledWith('guild-b', 'user-123');

    await vi.advanceTimersByTimeAsync(60_000);
    expect(deleteActivePunishment).toHaveBeenCalledWith('guild-b', 'user-123');
    expect(rolesRemove).toHaveBeenCalledTimes(2);
  });
});

// revokePunishment (Fase 2B, sección 1B) — único lugar que cancela el timer + borra la
// fila persistida + quita el rol, usado por /unpunish y por el select del panel
// /sanciones. Lo que más importa: que un timer con duración quedada armado quede
// REALMENTE cancelado (no solo "borrado de la fila", que ya cubría rescheduleAt-boot) —
// sin eso, la restricción "vencía" fantasma más tarde con un log de "expiración
// automática" mintiendo sobre algo que el staff ya había resuelto a mano.
describe('revokePunishment', () => {
  it('cancela el timer, borra la fila persistida y quita el rol — en ese orden', async () => {
    const { client, rolesRemove } = makeClient();
    const callOrder = [];
    deleteActivePunishment.mockImplementation(async () => {
      callOrder.push('delete-row');
    });
    rolesRemove.mockImplementation(async () => {
      callOrder.push('remove-role');
    });

    schedulePunishExpiry(client, makePunishment({ expiresAt: Date.now() + 60_000 }));

    const member = { roles: { cache: { has: () => true }, remove: rolesRemove } };
    await revokePunishment(client, { guildId: 'guild-1', userId: 'target-1', roleId: 'role-sancionado', member });

    expect(callOrder).toEqual(['delete-row', 'remove-role']);

    // El timer que había quedado armado por schedulePunishExpiry no debe disparar
    // después — si revokePunishment no lo hubiera cancelado de verdad, avanzar el reloj
    // dispararía una "expiración automática" fantasma (rolesRemove/deleteActivePunishment
    // de vuelta) sobre algo que ya se resolvió a mano.
    vi.clearAllMocks();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deleteActivePunishment).not.toHaveBeenCalled();
    expect(rolesRemove).not.toHaveBeenCalled();
  });

  it('funciona igual si la restricción nunca tuvo duración (sin timer que cancelar)', async () => {
    const { client, rolesRemove } = makeClient();
    const member = { roles: { cache: { has: () => true }, remove: rolesRemove } };

    await expect(
      revokePunishment(client, { guildId: 'guild-1', userId: 'target-1', roleId: 'role-sancionado', member }),
    ).resolves.toBeUndefined();

    expect(rolesRemove).toHaveBeenCalledWith('role-sancionado');
    expect(deleteActivePunishment).toHaveBeenCalledWith('guild-1', 'target-1');
  });

  it('si borrar la fila persistida falla, igual sigue y quita el rol (no deja la restricción a medias)', async () => {
    const { client, rolesRemove } = makeClient();
    deleteActivePunishment.mockRejectedValueOnce(new Error('supabase caído'));
    const member = { roles: { cache: { has: () => true }, remove: rolesRemove } };

    await expect(
      revokePunishment(client, { guildId: 'guild-1', userId: 'target-1', roleId: 'role-sancionado', member }),
    ).resolves.toBeUndefined();

    expect(rolesRemove).toHaveBeenCalledWith('role-sancionado');
  });
});

describe('rescheduleActivePunishments — reprogramar al reiniciar', () => {
  it('una restricción ya vencida expira ya; una futura espera su turno', async () => {
    const { client, rolesRemove } = makeClient();
    getAllActivePunishments.mockResolvedValue([
      makePunishment({ userId: 'vencido', expiresAt: Date.now() - 5_000 }),
      makePunishment({ userId: 'futuro', expiresAt: Date.now() + 60_000 }),
    ]);

    await rescheduleActivePunishments(client);
    await vi.advanceTimersByTimeAsync(0);

    expect(rolesRemove).toHaveBeenCalledTimes(1); // solo el vencido, todavía
    expect(deleteActivePunishment).toHaveBeenCalledWith('guild-1', 'vencido');

    await vi.advanceTimersByTimeAsync(60_000);
    expect(rolesRemove).toHaveBeenCalledTimes(2); // ahora también el futuro
    expect(deleteActivePunishment).toHaveBeenCalledWith('guild-1', 'futuro');
  });

  it('sin restricciones activas guardadas, no programa nada', async () => {
    const { client, rolesRemove } = makeClient();
    getAllActivePunishments.mockResolvedValue([]);

    await rescheduleActivePunishments(client);
    await vi.advanceTimersByTimeAsync(120_000);

    expect(rolesRemove).not.toHaveBeenCalled();
  });
});
