import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// /confession — MOD-4, Fase 4B: antes no existía ningún límite (a diferencia de
// /encuesta, que ya tenía este mismo fix desde Fase 2B — mismo patrón acá, ver
// tests/encuesta.test.js). El riesgo es peor que en /encuesta: contenido anónimo
// público, "quién lo mandó" no sirve de disuasivo social.
const getGuildConfig = vi.fn();
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig }));

const { execute: confessionExecute } = await import('../src/commands/diversion/confession.js');

function makeInteraction({ guildId = 'guild-1', userId = 'user-1' } = {}) {
  return {
    guildId,
    user: { id: userId, tag: `user-${userId}#0001` },
    showModal: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  getGuildConfig.mockResolvedValue({ confession_blocked_ids: [] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('/confession — cooldown por guild+usuario (MOD-4)', () => {
  it('primer uso: muestra el modal normalmente', async () => {
    const interaction = makeInteraction({ userId: 'conf-1' });

    await confessionExecute(interaction);

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('segunda ejecución RÁPIDA del mismo usuario: bloqueada por cooldown, sin mostrar el modal', async () => {
    const first = makeInteraction({ userId: 'conf-2' });
    await confessionExecute(first);

    const second = makeInteraction({ userId: 'conf-2' });
    await confessionExecute(second);

    expect(second.showModal).not.toHaveBeenCalled();
    expect(second.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Ya mandaste una confesión hace poco') }));
  });

  it('usuarios DISTINTOS no comparten el cooldown', async () => {
    const userA = makeInteraction({ userId: 'conf-a' });
    await confessionExecute(userA);

    const userB = makeInteraction({ userId: 'conf-b' });
    await confessionExecute(userB);

    expect(userB.showModal).toHaveBeenCalledTimes(1);
  });

  it('mismo usuario en OTRO servidor: no comparte el cooldown', async () => {
    const inGuildA = makeInteraction({ guildId: 'guild-a', userId: 'conf-3' });
    await confessionExecute(inGuildA);

    const inGuildB = makeInteraction({ guildId: 'guild-b', userId: 'conf-3' });
    await confessionExecute(inGuildB);

    expect(inGuildB.showModal).toHaveBeenCalledTimes(1);
  });

  it('un intento bloqueado por confession_blocked_ids no consume el cooldown', async () => {
    getGuildConfig.mockResolvedValue({ confession_blocked_ids: ['conf-4'] });
    const blocked = makeInteraction({ userId: 'conf-4' });
    await confessionExecute(blocked);
    expect(blocked.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No podés usar /confession') }));
    expect(blocked.showModal).not.toHaveBeenCalled();

    getGuildConfig.mockResolvedValue({ confession_blocked_ids: [] });
    const unblocked = makeInteraction({ userId: 'conf-4' });
    await confessionExecute(unblocked);

    expect(unblocked.showModal).toHaveBeenCalledTimes(1);
  });

  it('pasada la ventana de cooldown, se puede usar de nuevo', async () => {
    const first = makeInteraction({ userId: 'conf-5' });
    await confessionExecute(first);

    vi.setSystemTime(Date.now() + 2 * 60 * 1000 + 1);

    const second = makeInteraction({ userId: 'conf-5' });
    await confessionExecute(second);

    expect(second.showModal).toHaveBeenCalledTimes(1);
  });
});
