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

const { schedulePunishExpiry, cancelPunishExpiry, rescheduleActivePunishments } = await import('../src/utils/punishEngine.js');

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
