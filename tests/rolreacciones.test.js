import { vi, describe, it, expect, beforeEach } from 'vitest';

// /rolreacciones (plan de ejecución 2026-09-15) — P1 de Fase 4B, reaction-roles como
// panel de botones. Mismo tier que /config (dueño del servidor o Administrator nativo).
const getRoleValidationError = vi.fn(() => null);
const createReactionRolePanel = vi.fn().mockResolvedValue(undefined);
const getReactionRolePanel = vi.fn();
const deleteReactionRolePanel = vi.fn().mockResolvedValue(undefined);
const listReactionRolePanels = vi.fn().mockResolvedValue([]);
const buildReactionRolePanelMessage = vi.fn(() => ({ embeds: ['embed'], components: ['row'] }));
vi.mock('../src/utils/reactionRolePanels.js', () => ({
  getRoleValidationError: (...a) => getRoleValidationError(...a),
  createReactionRolePanel: (...a) => createReactionRolePanel(...a),
  getReactionRolePanel: (...a) => getReactionRolePanel(...a),
  deleteReactionRolePanel: (...a) => deleteReactionRolePanel(...a),
  listReactionRolePanels: (...a) => listReactionRolePanels(...a),
  buildReactionRolePanelMessage: (...a) => buildReactionRolePanelMessage(...a),
}));

const logConfigChange = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/commands/admin/config.js', () => ({ logConfigChange: (...a) => logConfigChange(...a) }));

const { execute } = await import('../src/commands/admin/rolreacciones.js');

function makeRole(id, name = id) {
  return { id, name, toString: () => `<@&${id}>` };
}

function makeInteraction({
  sub = 'crear',
  isOwner = false,
  isAdminPerm = true,
  roles = { rol1: makeRole('role-a', 'Gamer') },
  canal = null,
  titulo = null,
  descripcion = null,
  mensajeId = 'msg-1',
  sendImpl,
} = {}) {
  const message = {
    id: 'msg-nuevo',
    url: 'https://discord.com/channels/g/c/m',
    embeds: [{ title: 'Elegí tus roles' }],
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const defaultChannel = { id: 'chan-actual', send: sendImpl || vi.fn().mockResolvedValue(message), toString: () => '<#chan-actual>' };

  return {
    guildId: 'guild-1',
    guild: {
      id: 'guild-1',
      ownerId: isOwner ? 'user-1' : 'owner-otro',
      channels: { fetch: vi.fn().mockResolvedValue(null) },
    },
    channel: defaultChannel,
    user: { id: 'user-1' },
    member: { permissions: { has: () => isAdminPerm } },
    options: {
      getSubcommand: () => sub,
      getRole: (name) => roles[name] ?? null,
      getChannel: () => canal,
      getString: (name) => (name === 'titulo' ? titulo : name === 'descripcion' ? descripcion : name === 'mensaje_id' ? mensajeId : null),
    },
    reply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    _defaultChannel: defaultChannel,
    _message: message,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getRoleValidationError.mockReturnValue(null);
});

describe('/rolreacciones — permisos', () => {
  it('rechaza a quien no es dueño ni Administrator', async () => {
    const interaction = makeInteraction({ isOwner: false, isAdminPerm: false });

    await execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Solo el dueño') }));
    expect(createReactionRolePanel).not.toHaveBeenCalled();
  });
});

describe('/rolreacciones crear', () => {
  it('caso exitoso: valida roles, postea el panel, guarda y confirma', async () => {
    const interaction = makeInteraction({ roles: { rol1: makeRole('role-a', 'Gamer'), rol2: makeRole('role-b', 'Artista') } });

    await execute(interaction);

    expect(getRoleValidationError).toHaveBeenCalledTimes(2);
    expect(interaction._defaultChannel.send).toHaveBeenCalledWith({ embeds: ['embed'], components: ['row'] });
    expect(createReactionRolePanel).toHaveBeenCalledWith('guild-1', 'chan-actual', 'msg-nuevo', [
      { roleId: 'role-a', label: 'Gamer' },
      { roleId: 'role-b', label: 'Artista' },
    ], 'user-1');
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('✅ Panel creado') }));
    expect(logConfigChange).toHaveBeenCalled();
  });

  it('un rol inválido (peligroso o fuera de jerarquía): rechaza sin postear nada', async () => {
    getRoleValidationError.mockReturnValue('tiene el permiso **Administrador**');
    const interaction = makeInteraction({ roles: { rol1: makeRole('role-a', 'Peligroso') } });

    await execute(interaction);

    expect(interaction._defaultChannel.send).not.toHaveBeenCalled();
    expect(createReactionRolePanel).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Administrador') }));
  });

  it('roles duplicados (mismo rol elegido dos veces): se cuenta una sola vez', async () => {
    const dup = makeRole('role-a', 'Gamer');
    const interaction = makeInteraction({ roles: { rol1: dup, rol2: dup } });

    await execute(interaction);

    expect(getRoleValidationError).toHaveBeenCalledTimes(1);
    expect(createReactionRolePanel).toHaveBeenCalledWith('guild-1', expect.anything(), expect.anything(), [{ roleId: 'role-a', label: 'Gamer' }], 'user-1');
  });

  it('si channel.send falla (sin permiso para escribir ahí): avisa, no guarda nada', async () => {
    const failingSend = vi.fn().mockRejectedValue(new Error('Missing Access'));
    const interaction = makeInteraction({ sendImpl: failingSend });

    await execute(interaction);

    expect(createReactionRolePanel).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No se pudo crear') }));
  });

  // GIVE-1 (auditoría completa 2026-09-11, mismo bug class que /sorteo crear): si el
  // mensaje SÍ se posteó pero guardar la fila falla después, no puede quedar un panel
  // "fantasma" (visible, con botones que nunca van a encontrar una fila real).
  it('si createReactionRolePanel falla DESPUÉS de postear: borra el mensaje para no dejarlo fantasma', async () => {
    createReactionRolePanel.mockRejectedValueOnce(new Error('supabase timeout'));
    const interaction = makeInteraction();

    await execute(interaction);

    expect(interaction._message.delete).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No se pudo crear') }));
  });

  it('sin canal explícito: usa el canal donde se corrió el comando', async () => {
    const interaction = makeInteraction({ canal: null });

    await execute(interaction);

    expect(createReactionRolePanel).toHaveBeenCalledWith('guild-1', 'chan-actual', expect.anything(), expect.anything(), expect.anything());
  });
});

describe('/rolreacciones eliminar', () => {
  it('panel inexistente: avisa, no borra nada', async () => {
    getReactionRolePanel.mockResolvedValue(null);
    const interaction = makeInteraction({ sub: 'eliminar' });

    await execute(interaction);

    expect(deleteReactionRolePanel).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No encontré') }));
  });

  it('panel existente: borra la fila y confirma (mensaje real ya no accesible: best-effort, no revienta)', async () => {
    getReactionRolePanel.mockResolvedValue({ guildId: 'guild-1', channelId: 'chan-1', messageId: 'msg-1', roles: [] });
    const interaction = makeInteraction({ sub: 'eliminar' });

    await execute(interaction);

    expect(deleteReactionRolePanel).toHaveBeenCalledWith('guild-1', 'msg-1');
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('✅ Panel eliminado') }));
    expect(logConfigChange).toHaveBeenCalled();
  });
});

describe('/rolreacciones listar', () => {
  it('sin paneles: lo dice claro', async () => {
    listReactionRolePanels.mockResolvedValue([]);
    const interaction = makeInteraction({ sub: 'listar' });

    await execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('todavía no tiene paneles') }));
  });

  it('con paneles: arma un embed con un campo por panel', async () => {
    listReactionRolePanels.mockResolvedValue([{ channelId: 'chan-1', messageId: 'msg-1', roles: [{ roleId: 'role-a' }] }]);
    const interaction = makeInteraction({ sub: 'listar' });

    await execute(interaction);

    const payload = interaction.reply.mock.calls[0][0];
    expect(payload.embeds[0].data.fields).toHaveLength(1);
  });
});
