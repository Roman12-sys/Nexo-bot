import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// userUpdate.js — Fase 2B, sección 8: throttle de 2 min por usuario para no hacer un
// fan-out completo (a TODOS los servidores mutuos) por cada cambio de perfil, cuando
// varios cambios seguidos del MISMO usuario en poco tiempo son comunes (probar avatares).
//
// Cada test usa un userId DISTINTO a propósito: lastLoggedAt es un Map a nivel de
// módulo (no un mock, estado real del archivo bajo test) que persiste entre tests del
// mismo archivo — reusar un id entre tests haría que el throttle de un test se filtrara
// al siguiente.
const createAvatarChangeLogEmbed = vi.fn(() => ({ kind: 'avatar' }));
const createUsernameChangeLogEmbed = vi.fn(() => ({ kind: 'username' }));
vi.mock('../src/utils/logEmbeds.js', () => ({ createAvatarChangeLogEmbed, createUsernameChangeLogEmbed }));

const getGuildLogChannel = vi.fn();
vi.mock('../src/utils/guildLogChannels.js', () => ({ getGuildLogChannel }));

const { execute: userUpdateExecute } = await import('../src/events/userUpdate.js');

function makeClient({ guildIds = ['g1'] } = {}) {
  const guildsArray = guildIds.map((id) => ({ id, members: { cache: { has: () => true } } }));
  return {
    guilds: {
      cache: {
        filter: (predicate) => {
          const matched = guildsArray.filter(predicate);
          return { size: matched.length, values: () => matched.values() };
        },
      },
    },
  };
}

function user(id, overrides = {}) {
  return { id, avatar: 'a1', username: 'name', globalName: 'Name', ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('userUpdate — throttle por usuario', () => {
  it('un cambio de avatar real se loguea', async () => {
    const client = makeClient();
    const logChannel = { send: vi.fn().mockResolvedValue(undefined) };
    getGuildLogChannel.mockResolvedValue(logChannel);

    await userUpdateExecute(user('throttle-1'), user('throttle-1', { avatar: 'a2' }), client);

    expect(logChannel.send).toHaveBeenCalledTimes(1);
  });

  it('varios cambios seguidos del MISMO usuario dentro de la ventana: solo el primero loguea', async () => {
    const client = makeClient();
    const logChannel = { send: vi.fn().mockResolvedValue(undefined) };
    getGuildLogChannel.mockResolvedValue(logChannel);

    await userUpdateExecute(user('throttle-2'), user('throttle-2', { avatar: 'a2' }), client);
    await userUpdateExecute(user('throttle-2', { avatar: 'a2' }), user('throttle-2', { avatar: 'a3' }), client);
    await userUpdateExecute(user('throttle-2', { avatar: 'a3' }), user('throttle-2', { avatar: 'a4' }), client);

    expect(logChannel.send).toHaveBeenCalledTimes(1);
  });

  it('pasada la ventana de throttle, un cambio nuevo del mismo usuario sí loguea', async () => {
    const client = makeClient();
    const logChannel = { send: vi.fn().mockResolvedValue(undefined) };
    getGuildLogChannel.mockResolvedValue(logChannel);

    await userUpdateExecute(user('throttle-3'), user('throttle-3', { avatar: 'a2' }), client);
    vi.setSystemTime(Date.now() + 2 * 60 * 1000 + 1);
    await userUpdateExecute(user('throttle-3', { avatar: 'a2' }), user('throttle-3', { avatar: 'a3' }), client);

    expect(logChannel.send).toHaveBeenCalledTimes(2);
  });

  it('dos usuarios distintos no comparten el throttle', async () => {
    const client = makeClient();
    const logChannel = { send: vi.fn().mockResolvedValue(undefined) };
    getGuildLogChannel.mockResolvedValue(logChannel);

    await userUpdateExecute(user('throttle-4a'), user('throttle-4a', { avatar: 'a2' }), client);
    await userUpdateExecute(user('throttle-4b'), user('throttle-4b', { avatar: 'b2' }), client);

    expect(logChannel.send).toHaveBeenCalledTimes(2);
  });

  it('un UserUpdate sin cambios rastreados no consume la ventana de throttle', async () => {
    const client = makeClient();
    const logChannel = { send: vi.fn().mockResolvedValue(undefined) };
    getGuildLogChannel.mockResolvedValue(logChannel);

    // discriminator u otro campo que no nos importa — ninguno de los 3 embeds aplica.
    await userUpdateExecute(user('throttle-5'), user('throttle-5'), client);
    expect(logChannel.send).not.toHaveBeenCalled();

    // El cambio real, inmediatamente después, no debería quedar bloqueado por el no-op de arriba.
    await userUpdateExecute(user('throttle-5'), user('throttle-5', { avatar: 'a2' }), client);
    expect(logChannel.send).toHaveBeenCalledTimes(1);
  });

  it('sin servidores mutuos, no llama al canal de logs', async () => {
    const client = makeClient({ guildIds: [] });
    await userUpdateExecute(user('throttle-6'), user('throttle-6', { avatar: 'a2' }), client);

    expect(getGuildLogChannel).not.toHaveBeenCalled();
  });
});
