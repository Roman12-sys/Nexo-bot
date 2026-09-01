import { vi, describe, it, expect, beforeEach } from 'vitest';

// guildMemberRemove.js toca discord.js REST (auditLog, canal de logs) — se mockea todo
// lo que no es el punto bajo prueba (Fase 2A, 2026-08-31: limpieza de afkStore.js al
// irse un miembro, ver CLAUDE.md "AFK STORE"). No es un test de logging (eso ya está
// cubierto en otro lado) — el foco acá es que clearAfk se llama SIEMPRE, incluso si el
// server no tiene canal de logs de actividad configurado.
const clearAfk = vi.fn();
vi.mock('../src/utils/afkStore.js', () => ({ clearAfk }));

const getGuildLogChannel = vi.fn();
vi.mock('../src/utils/guildLogChannels.js', () => ({ getGuildLogChannel }));

const findExecutor = vi.fn();
vi.mock('../src/utils/auditLog.js', () => ({ findExecutor }));

const { execute } = await import('../src/events/guildMemberRemove.js');

function makeMember(overrides = {}) {
  return {
    id: 'user-1',
    guild: { id: 'guild-1' },
    user: { id: 'user-1', tag: 'user#0001' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('guildMemberRemove — limpieza de afkStore', () => {
  it('limpia el AFK del usuario incluso cuando el server no tiene canal de logs configurado', async () => {
    getGuildLogChannel.mockResolvedValue(null);

    await execute(makeMember(), { user: { id: 'bot-1' } });

    expect(clearAfk).toHaveBeenCalledWith('guild-1', 'user-1');
  });

  it('limpia el AFK del usuario también cuando SÍ hay canal de logs y se loguea la salida', async () => {
    getGuildLogChannel.mockResolvedValue({ send: vi.fn().mockResolvedValue(undefined) });
    findExecutor.mockResolvedValue(null);

    await execute(makeMember(), { user: { id: 'bot-1' } });

    expect(clearAfk).toHaveBeenCalledWith('guild-1', 'user-1');
  });
});
