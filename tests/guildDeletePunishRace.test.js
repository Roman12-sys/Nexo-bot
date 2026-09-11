import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSupabaseMock } from './helpers/supabaseMock.js';

// Auditoría adversarial round 2, Bloque 5 — guildDelete.js borraba `active_punishments`
// por guild_id pero nunca cancelaba el setTimeout vivo en memoria de punishEngine.js. Si
// ese timer vencía DESPUÉS de que el guild ya se había limpiado (el bot fue expulsado,
// o guildDelete ya corrió), expirePunishment insertaba una fila NUEVA en
// moderation_actions para un guild que guildDelete.js ya había vaciado — exactamente el
// dato huérfano que ese handler existe para evitar. El fix tiene DOS capas: (1)
// guildDelete.js cancela proactivamente todos los timers del guild ANTES de borrar, vía
// cancelAllPunishExpiryForGuild; (2) expirePunishment revalida por las dudas si el
// guild sigue existiendo antes de escribir cualquier historial — red de respaldo para
// la carrera donde el callback ya había arrancado a ejecutarse.
const supabaseMock = createSupabaseMock();
vi.mock('../src/supabaseClient.js', () => ({ get supabase() { return supabaseMock; } }));

const invalidateGuildConfig = vi.fn();
vi.mock('../src/utils/guildConfigStore.js', () => ({ invalidateGuildConfig }));

const clearGuildAfk = vi.fn();
vi.mock('../src/utils/afkStore.js', () => ({ clearGuildAfk }));

const getGuildLogChannel = vi.fn().mockResolvedValue(null);
vi.mock('../src/utils/guildLogChannels.js', () => ({ getGuildLogChannel }));

const createPunishLogEmbed = vi.fn(() => ({}));
vi.mock('../src/utils/logEmbeds.js', () => ({ createPunishLogEmbed }));

const recordModerationAction = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/moderationActionsStore.js', () => ({ recordModerationAction }));

const { execute: guildDeleteExecute } = await import('../src/events/guildDelete.js');
const { schedulePunishExpiry, cancelAllPunishExpiryForGuild } = await import('../src/utils/punishEngine.js');

function makeClient({ guildExists = true, hasRole = true } = {}) {
  const rolesRemove = vi.fn().mockResolvedValue(undefined);
  const member = {
    roles: { cache: { has: () => hasRole }, remove: rolesRemove },
    user: { id: 'target-1', tag: 'target-1#0001' },
  };
  const guild = { members: { fetch: vi.fn().mockResolvedValue(member) } };
  const client = {
    guilds: { fetch: vi.fn().mockResolvedValue(guildExists ? guild : null) },
    users: { fetch: vi.fn().mockResolvedValue(member.user) },
    user: { id: 'bot-1' },
  };
  return { client, rolesRemove };
}

function makePunishment(overrides = {}) {
  return { guildId: 'guild-race', userId: 'target-1', roleId: 'role-sancionado', expiresAt: Date.now() + 60_000, ...overrides };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('guildDelete cancela timers de punishEngine (capa 1: proactiva)', () => {
  it('escenario del bug: guild con un punishment activo -> guildDelete -> el timer NUNCA dispara después, ni escribe moderation_actions', async () => {
    const { client, rolesRemove } = makeClient();
    schedulePunishExpiry(client, makePunishment({ expiresAt: Date.now() + 60_000 }));

    await guildDeleteExecute({ id: 'guild-race', name: 'Servidor de prueba' });

    // active_punishments se borró como parte de la limpieza normal.
    expect(supabaseMock.getBuilder('active_punishments').delete).toHaveBeenCalled();
    expect(supabaseMock.getBuilder('active_punishments').eq).toHaveBeenCalledWith('guild_id', 'guild-race');

    // Avanzar el reloj MUY por encima de expiresAt: si el timer no se hubiera
    // cancelado, esto dispararía expirePunishment y escribiría moderation_actions.
    await vi.advanceTimersByTimeAsync(120_000);

    expect(rolesRemove).not.toHaveBeenCalled();
    expect(recordModerationAction).not.toHaveBeenCalled();
    expect(getGuildLogChannel).not.toHaveBeenCalled();
  });

  it('cancelAllPunishExpiryForGuild solo cancela los timers DEL GUILD indicado, nunca los de otro', async () => {
    const { client: clientRace, rolesRemove: removeRace } = makeClient();
    const { client: clientOther, rolesRemove: removeOther } = makeClient();

    schedulePunishExpiry(clientRace, makePunishment({ guildId: 'guild-race', expiresAt: Date.now() + 30_000 }));
    schedulePunishExpiry(clientOther, makePunishment({ guildId: 'guild-otro', expiresAt: Date.now() + 30_000 }));

    cancelAllPunishExpiryForGuild('guild-race');
    await vi.advanceTimersByTimeAsync(30_000);

    expect(removeRace).not.toHaveBeenCalled(); // cancelado
    expect(removeOther).toHaveBeenCalledTimes(1); // el de otro guild expira normal
  });

  it('cancelar un guild sin ningún timer activo no revienta', () => {
    expect(() => cancelAllPunishExpiryForGuild('guild-sin-nada')).not.toThrow();
  });

  it('múltiples usuarios sancionados en el mismo guild: guildDelete cancela TODOS sus timers de una', async () => {
    const { client: clientA, rolesRemove: removeA } = makeClient();
    const clientBSetup = makeClient({ hasRole: true });

    schedulePunishExpiry(clientA, makePunishment({ userId: 'user-a', expiresAt: Date.now() + 30_000 }));
    schedulePunishExpiry(clientBSetup.client, makePunishment({ userId: 'user-b', expiresAt: Date.now() + 30_000 }));

    await guildDeleteExecute({ id: 'guild-race', name: 'Servidor de prueba' });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(removeA).not.toHaveBeenCalled();
    expect(clientBSetup.rolesRemove).not.toHaveBeenCalled();
    expect(recordModerationAction).not.toHaveBeenCalled();
  });
});

describe('expirePunishment revalida el guild antes de persistir (capa 2: red de respaldo)', () => {
  it('condición de carrera: el timer YA había arrancado (guildDelete corrió en el medio) — el guild ya no resuelve, no se escribe moderation_actions ni logs, pero la fila igual se limpia', async () => {
    // Simula la carrera: el timer dispara y client.guilds.fetch ya devuelve null
    // (el bot fue expulsado / guildDelete corrió) ANTES de que expirePunishment llegue
    // a escribir nada — el caso donde cancelAllPunishExpiryForGuild llegó demasiado
    // tarde porque el callback ya estaba en vuelo.
    const { client } = makeClient({ guildExists: false });
    schedulePunishExpiry(client, makePunishment({ expiresAt: Date.now() + 10_000 }));

    await vi.advanceTimersByTimeAsync(10_000);

    expect(recordModerationAction).not.toHaveBeenCalled();
    expect(getGuildLogChannel).not.toHaveBeenCalled();
    // La fila persistida igual se limpia — no queda un active_punishments huérfano.
    expect(supabaseMock.getBuilder('active_punishments').delete).toHaveBeenCalled();
    expect(supabaseMock.getBuilder('active_punishments').eq).toHaveBeenCalledWith('user_id', 'target-1');
  });

  it('caso normal (guild sigue existiendo): sigue quitando el rol y logueando como siempre — sin regresión', async () => {
    const { client, rolesRemove } = makeClient({ guildExists: true });
    schedulePunishExpiry(client, makePunishment({ expiresAt: Date.now() + 10_000 }));

    await vi.advanceTimersByTimeAsync(10_000);

    expect(rolesRemove).toHaveBeenCalledWith('role-sancionado', expect.any(String));
    expect(recordModerationAction).toHaveBeenCalledTimes(1);
  });
});
