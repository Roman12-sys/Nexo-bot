import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeInteraction, makeTargetMember } from './helpers/discordMock.js';

// timeout/lock/unlock/unban — Fase 2B, sección 3: los 4 pasaron a deferir antes de su
// operación lenta contra Discord (antes el primer ack llegaba después de esa llamada,
// arriesgando "Unknown interaction" aunque la acción SÍ se hubiera aplicado). Sin
// cobertura previa — foco en que el defer/editReply no rompa el lifecycle normal
// (permiso → validación → acción → confirmación → log), no en redocumentar reglas de
// jerarquía ya cubiertas en moderation.test.js.
const getGuildConfig = vi.fn();
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig }));

const getGuildLogChannel = vi.fn().mockResolvedValue(null);
vi.mock('../src/utils/guildLogChannels.js', () => ({ getGuildLogChannel }));

const recordModerationAction = vi.fn().mockResolvedValue(undefined);
const getGuildFrequentReasons = vi.fn().mockResolvedValue([]);
vi.mock('../src/utils/moderationActionsStore.js', () => ({ recordModerationAction, getGuildFrequentReasons }));

const { execute: timeoutExecute } = await import('../src/commands/moderacion/timeout.js');
const { execute: lockExecute } = await import('../src/commands/moderacion/lock.js');
const { execute: unlockExecute } = await import('../src/commands/moderacion/unlock.js');
const { execute: unbanExecute } = await import('../src/commands/moderacion/unban.js');

const STAFF_CFG = { admin_role_id: 'role-admin', moderator_role_id: null };
const NO_STAFF_CFG = { admin_role_id: null, moderator_role_id: null };

beforeEach(() => {
  vi.clearAllMocks();
  getGuildConfig.mockResolvedValue(STAFF_CFG);
  getGuildLogChannel.mockResolvedValue(null);
});

describe('/timeout', () => {
  it('sin permisos: no llama a member.timeout', async () => {
    getGuildConfig.mockResolvedValue(NO_STAFF_CFG);
    const interaction = makeInteraction({ staffRoleIds: [], options: { duracion: '3600000' } });

    await timeoutExecute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('permisos') }));
  });

  it('usuario que ya no está en el servidor', async () => {
    const interaction = makeInteraction({ staffRoleIds: ['role-admin'], targetMember: null, options: { duracion: '3600000' } });

    await timeoutExecute(interaction);

    expect(interaction.deferReply).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No se encontró') }));
  });

  it('jerarquía: target de rango igual/superior queda bloqueado', async () => {
    const interaction = makeInteraction({
      staffRoleIds: ['role-admin'],
      userPosition: 5,
      targetMember: makeTargetMember({ position: 5 }),
      options: { duracion: '3600000' },
    });

    await timeoutExecute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('rango') }));
  });

  it('caso exitoso: llama a member.timeout con la duración y motivo, y loguea', async () => {
    const targetMember = makeTargetMember();
    targetMember.timeout = vi.fn().mockResolvedValue(undefined);
    const interaction = makeInteraction({ staffRoleIds: ['role-admin'], targetMember, options: { duracion: '3600000', motivo: 'flood' } });
    getGuildLogChannel.mockResolvedValue({ send: vi.fn().mockResolvedValue(undefined) });

    await timeoutExecute(interaction);

    expect(targetMember.timeout).toHaveBeenCalledWith(3600000, 'flood');
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Se silenció') }));
    expect(recordModerationAction).toHaveBeenCalledWith('guild-1', 'target-1', expect.objectContaining({ actionType: 'timeout', extra: { until: expect.any(Number) } }));
  });
});

function makeChannelInteraction({ staffRoleIds = ['role-admin'], hasManageChannels = true, editImpl } = {}) {
  return {
    guild: {
      id: 'guild-1',
      members: { me: { permissionsIn: () => ({ has: () => hasManageChannels }) } },
    },
    guildId: 'guild-1',
    channel: { permissionOverwrites: { edit: editImpl || vi.fn().mockResolvedValue(undefined) } },
    user: { id: 'mod-1', tag: 'mod-1#0001' },
    member: { roles: { cache: new Map(staffRoleIds.map((id) => [id, { id }])) } },
    client: { user: { id: 'bot-1' } },
    reply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/lock', () => {
  it('sin permisos: no toca el canal', async () => {
    getGuildConfig.mockResolvedValue(NO_STAFF_CFG);
    const interaction = makeChannelInteraction({ staffRoleIds: [] });

    await lockExecute(interaction);

    expect(interaction.channel.permissionOverwrites.edit).not.toHaveBeenCalled();
  });

  it('al bot le falta "Gestionar canales": mensaje claro, no intenta bloquear', async () => {
    const interaction = makeChannelInteraction({ hasManageChannels: false });

    await lockExecute(interaction);

    expect(interaction.channel.permissionOverwrites.edit).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Gestionar canales') }));
  });

  it('caso exitoso: bloquea @everyone y loguea', async () => {
    const interaction = makeChannelInteraction();
    getGuildLogChannel.mockResolvedValue({ send: vi.fn().mockResolvedValue(undefined) });

    await lockExecute(interaction);

    expect(interaction.channel.permissionOverwrites.edit).toHaveBeenCalledWith('guild-1', { SendMessages: false });
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('bloqueado') }));
  });

  it('si el edit de permisos falla, responde con error en vez de reventar', async () => {
    const interaction = makeChannelInteraction({ editImpl: vi.fn().mockRejectedValue(new Error('sin permiso real')) });

    await expect(lockExecute(interaction)).resolves.toBeUndefined();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('error') }));
  });
});

describe('/unlock', () => {
  it('caso exitoso: desbloquea @everyone y loguea', async () => {
    const interaction = makeChannelInteraction();
    getGuildLogChannel.mockResolvedValue({ send: vi.fn().mockResolvedValue(undefined) });

    await unlockExecute(interaction);

    expect(interaction.channel.permissionOverwrites.edit).toHaveBeenCalledWith('guild-1', { SendMessages: null });
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('desbloqueado') }));
  });
});

function makeUnbanInteraction({ staffRoleIds = ['role-admin'], unbanImpl, userId = 'target-1' } = {}) {
  return {
    guild: { members: { unban: unbanImpl || vi.fn().mockResolvedValue(undefined) } },
    guildId: 'guild-1',
    user: { id: 'mod-1', tag: 'mod-1#0001' },
    member: { roles: { cache: new Map(staffRoleIds.map((id) => [id, { id }])) } },
    client: { user: { id: 'bot-1' }, users: { fetch: vi.fn(async (id) => (id === userId ? { id, tag: `user-${id}#0001` } : null)) } },
    options: { getString: (name) => (name === 'usuario' ? userId : 'sin motivo') },
    reply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/unban', () => {
  it('sin permisos: no llama a members.unban', async () => {
    getGuildConfig.mockResolvedValue(NO_STAFF_CFG);
    const interaction = makeUnbanInteraction({ staffRoleIds: [] });

    await unbanExecute(interaction);

    expect(interaction.guild.members.unban).not.toHaveBeenCalled();
  });

  it('caso exitoso: desbanea y loguea', async () => {
    const interaction = makeUnbanInteraction();
    getGuildLogChannel.mockResolvedValue({ send: vi.fn().mockResolvedValue(undefined) });

    await unbanExecute(interaction);

    expect(interaction.guild.members.unban).toHaveBeenCalledWith('target-1', 'sin motivo');
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Se desbaneó') }));
  });

  it('usuario no baneado: responde con error en vez de reventar o responder dos veces', async () => {
    const interaction = makeUnbanInteraction({ unbanImpl: vi.fn().mockRejectedValue(new Error('Unknown Ban')) });

    await expect(unbanExecute(interaction)).resolves.toBeUndefined();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('desbanear') }));
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});
