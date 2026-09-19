import { vi, describe, it, expect, beforeEach } from 'vitest';

// NEXO Setup Inteligente, Bloque 10 — contador de miembros. Sin precedente previo en el
// proyecto de renombrar un canal en loop, y Discord limita los renames a ~2/10min por
// canal — estos tests protegen el invariante real: un rename SOLO se dispara si el
// conteo cambió desde la última vez guardada, nunca un "touch" sin cambios reales.
const getGuildConfig = vi.fn();
const setGuildConfig = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig, setGuildConfig }));

const reportCriticalError = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/errorReporter.js', () => ({ reportCriticalError }));

const { syncMemberCounterForGuild, runMemberCounterSweep, buildCounterChannelName } = await import('../src/utils/memberCounterEngine.js');

function makeGuild({ guildId = 'guild-1', memberCount = 42, channel = undefined } = {}) {
  const channels = new Map();
  if (channel) channels.set(channel.id, channel);
  return {
    id: guildId,
    memberCount,
    channels: {
      cache: channels,
      fetch: vi.fn(async (id) => channels.get(id) || null),
    },
  };
}

function makeRealChannel(id, name) {
  const obj = { id, name };
  obj.setName = vi.fn(async (newName) => {
    obj.name = newName;
  });
  return obj;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('memberCounterEngine — buildCounterChannelName', () => {
  it('arma el nombre con el emoji fijo y el conteo real (el separador de miles depende del ICU del entorno)', () => {
    expect(buildCounterChannelName(1234)).toBe(`👥・Miembros: ${(1234).toLocaleString('es-ES')}`);
    expect(buildCounterChannelName(7)).toBe('👥・Miembros: 7');
  });
});

describe('memberCounterEngine — syncMemberCounterForGuild', () => {
  it('sin canal configurado: no hace nada', async () => {
    getGuildConfig.mockResolvedValue({ member_counter_channel_id: null });
    const guild = makeGuild();

    const result = await syncMemberCounterForGuild(guild);

    expect(result).toEqual({ updated: false });
    expect(setGuildConfig).not.toHaveBeenCalled();
  });

  it('canal configurado pero borrado del servidor: no revienta, marca "missing"', async () => {
    getGuildConfig.mockResolvedValue({ member_counter_channel_id: 'chan-borrado', member_counter_last_count: 10 });
    const guild = makeGuild();

    const result = await syncMemberCounterForGuild(guild);

    expect(result).toEqual({ updated: false, missing: true });
    expect(setGuildConfig).not.toHaveBeenCalled();
  });

  it('el conteo NO cambió desde la última vez: no llama setName ni gasta el rate limit', async () => {
    const channel = makeRealChannel('chan-1', '👥・Miembros: 42');
    getGuildConfig.mockResolvedValue({ member_counter_channel_id: 'chan-1', member_counter_last_count: 42 });
    const guild = makeGuild({ memberCount: 42, channel });

    const result = await syncMemberCounterForGuild(guild);

    expect(result).toEqual({ updated: false });
    expect(channel.setName).not.toHaveBeenCalled();
    expect(setGuildConfig).not.toHaveBeenCalled();
  });

  it('el conteo cambió: renombra el canal y persiste el nuevo last_count', async () => {
    const channel = makeRealChannel('chan-1', '👥・Miembros: 41');
    getGuildConfig.mockResolvedValue({ member_counter_channel_id: 'chan-1', member_counter_last_count: 41 });
    const guild = makeGuild({ memberCount: 42, channel });

    const result = await syncMemberCounterForGuild(guild);

    expect(result).toEqual({ updated: true });
    expect(channel.setName).toHaveBeenCalledWith('👥・Miembros: 42', expect.any(String));
    expect(setGuildConfig).toHaveBeenCalledWith('guild-1', { member_counter_last_count: 42 });
  });

  it('el nombre visible YA coincide (recién creado con el nombre correcto): sincroniza last_count sin gastar un rename', async () => {
    const channel = makeRealChannel('chan-1', '👥・Miembros: 42');
    getGuildConfig.mockResolvedValue({ member_counter_channel_id: 'chan-1', member_counter_last_count: null });
    const guild = makeGuild({ memberCount: 42, channel });

    const result = await syncMemberCounterForGuild(guild);

    expect(result).toEqual({ updated: false });
    expect(channel.setName).not.toHaveBeenCalled();
    expect(setGuildConfig).toHaveBeenCalledWith('guild-1', { member_counter_last_count: 42 });
  });
});

describe('memberCounterEngine — runMemberCounterSweep', () => {
  it('un guild que falla (ej. rate limit de Discord) no frena el barrido de los demás', async () => {
    const channelOk = makeRealChannel('chan-ok', '👥・Miembros: 1');
    const channelFails = makeRealChannel('chan-fail', '👥・Miembros: 1');
    channelFails.setName = vi.fn().mockRejectedValue(new Error('rate limited'));

    const guildOk = makeGuild({ guildId: 'guild-ok', memberCount: 2, channel: channelOk });
    const guildFails = makeGuild({ guildId: 'guild-fail', memberCount: 2, channel: channelFails });

    getGuildConfig.mockImplementation(async (id) =>
      id === 'guild-ok'
        ? { member_counter_channel_id: 'chan-ok', member_counter_last_count: 1 }
        : { member_counter_channel_id: 'chan-fail', member_counter_last_count: 1 },
    );

    const client = { guilds: { cache: new Map([['guild-ok', guildOk], ['guild-fail', guildFails]]) } };

    await expect(runMemberCounterSweep(client)).resolves.not.toThrow();
    expect(channelOk.setName).toHaveBeenCalled();
    // El guild que falló nunca marcó last_count como si el cambio se hubiera aplicado.
    expect(setGuildConfig).not.toHaveBeenCalledWith('guild-fail', expect.anything());
  });
});
