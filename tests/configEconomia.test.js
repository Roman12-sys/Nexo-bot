import { vi, describe, it, expect, beforeEach } from 'vitest';

// /config economia — tuning de economía por servidor, núcleo (plan de ejecución
// 2026-09-15). Subcommand GROUP (no subcomandos sueltos) para no seguir agregando al
// nivel de arriba, ya con ~18 subcomandos. Cada par min/max se pide COMPLETO (nunca
// "solo minimo") para que nunca quede un min>max implícito contra el default global.
const setGuildConfig = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig: vi.fn(), setGuildConfig }));

const getGuildLogChannel = vi.fn();
vi.mock('../src/utils/guildLogChannels.js', () => ({ getGuildLogChannel }));

const { execute } = await import('../src/commands/admin/config.js');

function makeInteraction({ sub, options = {}, isOwner = true, isAdminPerm = true }) {
  return {
    guild: { ownerId: isOwner ? 'user-1' : 'owner-otro' },
    member: { permissions: { has: () => isAdminPerm } },
    user: { id: 'user-1', tag: 'admin#0001' },
    guildId: 'guild-1',
    client: {},
    options: {
      getSubcommandGroup: () => 'economia',
      getSubcommand: () => sub,
      getInteger: (name) => options[name] ?? null,
      getString: (name) => options[name] ?? null,
      getRole: () => null,
      getChannel: () => null,
      getBoolean: () => null,
      getUser: () => null,
    },
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

const logChannel = { send: vi.fn().mockResolvedValue(undefined) };

beforeEach(() => {
  vi.clearAllMocks();
  getGuildLogChannel.mockResolvedValue(logChannel);
});

describe('/config economia — permisos', () => {
  it('rechaza a quien no es dueño ni Administrator, sin llegar a leer nada de economía', async () => {
    const interaction = makeInteraction({ sub: 'diario', options: { minimo: 1, maximo: 2 }, isOwner: false, isAdminPerm: false });

    await execute(interaction);

    expect(setGuildConfig).not.toHaveBeenCalled();
  });
});

describe('/config economia diario', () => {
  it('guarda el rango y confirma', async () => {
    const interaction = makeInteraction({ sub: 'diario', options: { minimo: 200, maximo: 500 } });

    await execute(interaction);

    expect(setGuildConfig).toHaveBeenCalledWith('guild-1', { economy_daily_min: 200, economy_daily_max: 500 });
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('200–500') }));
    expect(logChannel.send).toHaveBeenCalledTimes(1);
  });

  it('mínimo mayor que máximo: rechaza sin guardar nada', async () => {
    const interaction = makeInteraction({ sub: 'diario', options: { minimo: 500, maximo: 200 } });

    await execute(interaction);

    expect(setGuildConfig).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('mínimo no puede ser mayor') }));
  });
});

describe('/config economia trabajo', () => {
  it('guarda el rango y confirma', async () => {
    const interaction = makeInteraction({ sub: 'trabajo', options: { minimo: 10, maximo: 20 } });

    await execute(interaction);

    expect(setGuildConfig).toHaveBeenCalledWith('guild-1', { economy_work_min: 10, economy_work_max: 20 });
  });
});

describe('/config economia crimen', () => {
  it('guarda rango + % de éxito y confirma', async () => {
    const interaction = makeInteraction({ sub: 'crimen', options: { minimo: 100, maximo: 200, exito: 75 } });

    await execute(interaction);

    expect(setGuildConfig).toHaveBeenCalledWith('guild-1', { economy_crime_min: 100, economy_crime_max: 200, economy_crime_success_percent: 75 });
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('75%') }));
  });

  it('mínimo mayor que máximo: rechaza sin guardar nada', async () => {
    const interaction = makeInteraction({ sub: 'crimen', options: { minimo: 200, maximo: 100, exito: 50 } });

    await execute(interaction);

    expect(setGuildConfig).not.toHaveBeenCalled();
  });
});

describe('/config economia robo', () => {
  it('guarda éxito + % de robo + % de multa y confirma', async () => {
    const interaction = makeInteraction({
      sub: 'robo',
      options: { exito: 30, 'robo-minimo': 5, 'robo-maximo': 15, 'multa-minimo': 2, 'multa-maximo': 8 },
    });

    await execute(interaction);

    expect(setGuildConfig).toHaveBeenCalledWith('guild-1', {
      economy_rob_success_percent: 30,
      economy_rob_steal_percent_min: 5,
      economy_rob_steal_percent_max: 15,
      economy_rob_fine_percent_min: 2,
      economy_rob_fine_percent_max: 8,
    });
  });

  it('% de robo mínimo mayor que el máximo: rechaza sin guardar nada', async () => {
    const interaction = makeInteraction({
      sub: 'robo',
      options: { exito: 30, 'robo-minimo': 15, 'robo-maximo': 5, 'multa-minimo': 2, 'multa-maximo': 8 },
    });

    await execute(interaction);

    expect(setGuildConfig).not.toHaveBeenCalled();
  });

  it('% de multa mínimo mayor que el máximo: rechaza sin guardar nada', async () => {
    const interaction = makeInteraction({
      sub: 'robo',
      options: { exito: 30, 'robo-minimo': 5, 'robo-maximo': 15, 'multa-minimo': 8, 'multa-maximo': 2 },
    });

    await execute(interaction);

    expect(setGuildConfig).not.toHaveBeenCalled();
  });
});

describe('/config economia restablecer', () => {
  it('sistema puntual: vuelve solo esos campos a null', async () => {
    const interaction = makeInteraction({ sub: 'restablecer', options: { sistema: 'diario' } });

    await execute(interaction);

    expect(setGuildConfig).toHaveBeenCalledWith('guild-1', { economy_daily_min: null, economy_daily_max: null });
  });

  it('"todo": vuelve los 12 campos de los 4 sistemas a null', async () => {
    const interaction = makeInteraction({ sub: 'restablecer', options: { sistema: 'todo' } });

    await execute(interaction);

    expect(setGuildConfig).toHaveBeenCalledWith('guild-1', {
      economy_daily_min: null,
      economy_daily_max: null,
      economy_work_min: null,
      economy_work_max: null,
      economy_crime_min: null,
      economy_crime_max: null,
      economy_crime_success_percent: null,
      economy_rob_success_percent: null,
      economy_rob_steal_percent_min: null,
      economy_rob_steal_percent_max: null,
      economy_rob_fine_percent_min: null,
      economy_rob_fine_percent_max: null,
    });
  });
});
