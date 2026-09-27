import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';

// Join to Create con un NEXO sin "Administrador" (2026-09-27). La sala nace privada
// (@everyone sin "Ver canal" ni "Conectar"), y los permisos del canal también se le
// aplican al bot: sin un permiso propio no veía la sala que acababa de crear, Discord no
// lo dejaba mover al usuario adentro (exige poder conectarse al canal destino) ni
// borrarla después — quedaba una sala huérfana por intento. Nunca se notó porque en
// todos los servidores donde NEXO anda el bot tiene "Administrador".
const createTempChannel = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/tempVoiceStore.js', () => ({
  createTempChannel: (...a) => createTempChannel(...a),
  getTempChannelByChannelId: vi.fn().mockResolvedValue(null),
  getTempChannelByOwner: vi.fn().mockResolvedValue(null),
  updateTempChannel: vi.fn(),
  deleteTempChannel: vi.fn().mockResolvedValue(undefined),
  transferTempChannelOwner: vi.fn(),
  getAllTempChannels: vi.fn(),
  recordChannelStats: vi.fn(),
  getGuildVoiceStatsSummary: vi.fn(),
}));

const getGuildVoiceConfig = vi.fn();
vi.mock('../src/utils/voiceConfigStore.js', () => ({
  getGuildVoiceConfig: (...a) => getGuildVoiceConfig(...a),
  upsertGuildVoiceConfig: vi.fn(),
  disableGuildVoiceConfig: vi.fn(),
}));

vi.mock('../src/utils/eventBus.js', () => ({ eventBus: { emit: vi.fn().mockResolvedValue(undefined), on: vi.fn() } }));

const { handleTempVoiceStateUpdate } = await import('../src/utils/tempVoiceEngine.js');

function makeScenario() {
  const newChannel = { id: 'sala-1', send: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined) };
  const guild = {
    id: 'guild-1',
    name: 'Server',
    roles: { everyone: { id: 'role-everyone' } },
    members: { me: { id: 'bot-1', permissions: { has: () => true } } },
    channels: { create: vi.fn().mockResolvedValue(newChannel), fetch: vi.fn().mockResolvedValue(null) },
  };
  const member = {
    id: 'user-1',
    displayName: 'Fran',
    user: { id: 'user-1' },
    voice: { channelId: 'crear-sala', setChannel: vi.fn().mockResolvedValue(undefined) },
  };
  const oldState = { channelId: null, guild };
  const newState = { channelId: 'crear-sala', guild, member, channel: null };
  return { guild, member, oldState, newState, newChannel };
}

beforeEach(() => {
  vi.clearAllMocks();
  getGuildVoiceConfig.mockResolvedValue({ enabled: true, createChannelId: 'crear-sala', categoryId: null });
});

describe('Join to Create — la sala nueva incluye el acceso del propio bot', () => {
  it('permisos iniciales: @everyone sin acceso, el dueño con acceso, y el bot con ver/conectar/escribir', async () => {
    const { guild, oldState, newState, member, newChannel } = makeScenario();

    await handleTempVoiceStateUpdate(oldState, newState);

    const { permissionOverwrites } = guild.channels.create.mock.calls[0][0];
    expect(permissionOverwrites).toContainEqual(expect.objectContaining({ id: 'role-everyone', deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] }));
    expect(permissionOverwrites).toContainEqual(expect.objectContaining({ id: 'user-1' }));
    const bot = permissionOverwrites.find((o) => o.id === 'bot-1');
    expect(bot).toMatchObject({ type: 1 });
    expect(bot.allow).toEqual(expect.arrayContaining([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.SendMessages]));
    // El flujo sigue igual que siempre: mueve al usuario y registra la sala.
    expect(member.voice.setChannel).toHaveBeenCalledWith(newChannel);
    expect(createTempChannel).toHaveBeenCalledWith(expect.objectContaining({ channelId: 'sala-1', ownerId: 'user-1' }));
  });

  it('solo se incluyen permisos que el bot tiene (Discord rechaza otorgar uno que no tiene)', async () => {
    const { guild, oldState, newState } = makeScenario();
    guild.members.me.permissions = { has: (flag) => flag !== PermissionFlagsBits.SendMessages };

    await handleTempVoiceStateUpdate(oldState, newState);

    const bot = guild.channels.create.mock.calls[0][0].permissionOverwrites.find((o) => o.id === 'bot-1');
    expect(bot.allow).not.toContain(PermissionFlagsBits.SendMessages);
    expect(bot.allow).toContain(PermissionFlagsBits.ViewChannel);
  });
});
