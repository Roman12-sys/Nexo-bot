import { vi, describe, it, expect, beforeEach } from 'vitest';

// /punish — Fase 2B, sección 3 (defer antes de member.roles.add, antes arriesgaba
// "Unknown interaction") — sin cobertura previa pese a ser el comando con más ramas de
// validación de los que se tocaron esta fase (config, target, jerarquía, rol
// inexistente/por encima del bot, ya sancionado, con/sin duración).
const getGuildConfig = vi.fn();
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig }));

const getGuildLogChannel = vi.fn().mockResolvedValue(null);
vi.mock('../src/utils/guildLogChannels.js', () => ({ getGuildLogChannel }));

const createPunishLogEmbed = vi.fn(() => ({}));
vi.mock('../src/utils/logEmbeds.js', () => ({ createPunishLogEmbed }));

const recordModerationAction = vi.fn().mockResolvedValue(undefined);
const getGuildFrequentReasons = vi.fn().mockResolvedValue([]);
vi.mock('../src/utils/moderationActionsStore.js', () => ({ recordModerationAction, getGuildFrequentReasons }));

const createActivePunishment = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/punishStore.js', () => ({ createActivePunishment }));

const schedulePunishExpiry = vi.fn();
vi.mock('../src/utils/punishEngine.js', () => ({ schedulePunishExpiry }));

const { execute: punishExecute } = await import('../src/commands/moderacion/punish.js');

const STAFF_CFG = { admin_role_id: 'role-admin', moderator_role_id: null, punish_role_id: 'role-sancionado' };

function makeInteraction({
  staffRoleIds = ['role-admin'],
  userPosition = 10,
  ownerId = 'owner-1',
  targetMember = null,
  punishRole = { position: 1 },
  botPosition = 50,
  options = {},
} = {}) {
  return {
    guild: {
      id: 'guild-1',
      ownerId,
      roles: { cache: { get: (id) => (id === 'role-sancionado' ? punishRole : undefined) } },
      members: {
        fetch: vi.fn(async (id) => (targetMember && id === targetMember.id ? targetMember : null)),
        me: { roles: { highest: { position: botPosition } } },
      },
    },
    guildId: 'guild-1',
    user: { id: 'mod-1', tag: 'mod-1#0001' },
    member: { roles: { highest: { position: userPosition }, cache: new Map(staffRoleIds.map((id) => [id, { id }])) } },
    client: { user: { id: 'bot-1' } },
    options: {
      getUser: () => ({ id: 'target-1', tag: 'target-1#0001' }),
      getString: (name) => options[name] ?? null,
    },
    reply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
  };
}

function targetMember({ position = 1, hasRole = false } = {}) {
  return { id: 'target-1', roles: { highest: { position }, cache: { has: () => hasRole }, add: vi.fn().mockResolvedValue(undefined) } };
}

beforeEach(() => {
  vi.clearAllMocks();
  getGuildConfig.mockResolvedValue(STAFF_CFG);
});

describe('/punish', () => {
  it('sin permisos: no llega a tocar roles', async () => {
    getGuildConfig.mockResolvedValue({ admin_role_id: null, moderator_role_id: null });
    const interaction = makeInteraction({ staffRoleIds: [] });

    await punishExecute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('permisos') }));
  });

  it('sin rol de castigo configurado', async () => {
    getGuildConfig.mockResolvedValue({ admin_role_id: 'role-admin', moderator_role_id: null, punish_role_id: null });
    const interaction = makeInteraction();

    await punishExecute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('rol-castigo') }));
  });

  it('usuario que ya no está en el servidor', async () => {
    const interaction = makeInteraction({ targetMember: null });

    await punishExecute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No se encontró') }));
  });

  it('jerarquía: target de rango igual/superior queda bloqueado', async () => {
    const interaction = makeInteraction({ userPosition: 5, ownerId: 'someone-else', targetMember: targetMember({ position: 5 }) });

    await punishExecute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('rango') }));
  });

  it('el usuario ya tiene la restricción aplicada', async () => {
    const interaction = makeInteraction({ targetMember: targetMember({ hasRole: true }) });

    await punishExecute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('ya tiene la restricción') }));
  });

  it('el rol de restricción configurado ya no existe en Discord', async () => {
    const interaction = makeInteraction({ targetMember: targetMember(), punishRole: null });

    await punishExecute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('ya no existe') }));
  });

  it('el rol de restricción está por encima del rol del bot', async () => {
    const interaction = makeInteraction({ targetMember: targetMember(), punishRole: { position: 100 }, botPosition: 50 });

    await punishExecute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('por encima de mi rol') }));
  });

  it('caso exitoso SIN duración: agrega el rol, no crea fila de expiración', async () => {
    const member = targetMember();
    const interaction = makeInteraction({ targetMember: member, options: { motivo: 'spam' } });

    await punishExecute(interaction);

    expect(member.roles.add).toHaveBeenCalledWith('role-sancionado', 'spam');
    expect(createActivePunishment).not.toHaveBeenCalled();
    expect(schedulePunishExpiry).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('ya no puede enviar') }));
    expect(interaction.editReply.mock.calls[0][0].content).not.toContain('quita sola');
  });

  it('caso exitoso CON duración: programa la expiración y lo dice en la respuesta', async () => {
    const member = targetMember();
    const interaction = makeInteraction({ targetMember: member, options: { motivo: 'spam', duracion: '1h' } });

    await punishExecute(interaction);

    expect(createActivePunishment).toHaveBeenCalledWith('guild-1', 'target-1', 'role-sancionado', expect.any(Number));
    expect(schedulePunishExpiry).toHaveBeenCalledWith(
      interaction.client,
      expect.objectContaining({ guildId: 'guild-1', userId: 'target-1', roleId: 'role-sancionado' }),
    );
    expect(interaction.editReply.mock.calls[0][0].content).toContain('quita sola');
  });
});
