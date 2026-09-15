import { vi, describe, it, expect, beforeEach } from 'vitest';

// /rolreacciones (plan de ejecución 2026-09-15) — reaction-roles como panel de botones.
// `crear` es un builder interactivo (mismo patrón que /anuncio, plan 2026-09-15
// "builder interactivo"): sesión en memoria por guild+usuario, selects nativos de
// Discord (RoleSelectMenuBuilder/ChannelSelectMenuBuilder), texto vía modal, un render
// que se re-edita con interaction.update() en cada cambio. Se ejercita a través de los
// routers REALES (routeButton/routeSelect/routeModal), mismo criterio que
// tests/selfRoles.test.js/tests/reactionRolePanels.test.js — nunca llamando a los
// handlers registrados a mano.
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
const { routeButton } = await import('../src/components/buttons.js');
const { routeSelect } = await import('../src/components/selects.js');
const { routeModal } = await import('../src/components/modals.js');

function makeRole(id, name = id) {
  return { id, name, toString: () => `<@&${id}>` };
}

const invokingChannel = { id: 'chan-invoking', toString: () => '<#chan-invoking>' };

function makeCommandInteraction({ sub = 'crear', isOwner = true, isAdminPerm = true, mensajeId = 'msg-1' } = {}) {
  return {
    guildId: 'guild-1',
    guild: { id: 'guild-1', ownerId: isOwner ? 'user-1' : 'owner-otro', channels: { fetch: vi.fn().mockResolvedValue(null) } },
    channel: invokingChannel,
    user: { id: 'user-1' },
    member: { permissions: { has: () => isAdminPerm } },
    options: { getSubcommand: () => sub, getString: (name) => (name === 'mensaje_id' ? mensajeId : null) },
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

function makeComponentInteraction({ customId, guildId = 'guild-1', userId = 'user-1', roles = [], channels = null, sendMessage } = {}) {
  const publishedChannel = { id: 'chan-invoking', send: sendMessage || vi.fn().mockResolvedValue({ id: 'msg-nuevo', url: 'https://discord.com/channels/g/c/m', delete: vi.fn().mockResolvedValue(undefined) }) };
  return {
    customId,
    guildId,
    guild: { id: guildId, channels: { fetch: vi.fn().mockResolvedValue(publishedChannel) } },
    channel: publishedChannel,
    user: { id: userId },
    roles, // Array.prototype.values() ya cubre el .values() que usa el handler
    channels: { first: () => channels },
    fields: { getTextInputValue: () => '' },
    reply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    showModal: vi.fn().mockResolvedValue(undefined),
  };
}

function makeModalInteraction({ customId, guildId = 'guild-1', userId = 'user-1', values = {} } = {}) {
  const publishedChannel = { id: 'chan-invoking', send: vi.fn().mockResolvedValue({ id: 'msg-nuevo', url: 'https://discord.com/channels/g/c/m', delete: vi.fn().mockResolvedValue(undefined) }) };
  return {
    customId,
    guildId,
    guild: { id: guildId, channels: { fetch: vi.fn().mockResolvedValue(publishedChannel) } },
    channel: publishedChannel,
    user: { id: userId },
    fields: { getTextInputValue: (name) => values[name] ?? '' },
    reply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getRoleValidationError.mockReturnValue(null);
});

describe('/rolreacciones — permisos', () => {
  it('rechaza a quien no es dueño ni Administrator', async () => {
    const interaction = makeCommandInteraction({ isOwner: false, isAdminPerm: false });

    await execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Solo el dueño') }));
  });
});

describe('/rolreacciones crear — abre la sesión', () => {
  it('responde ephemeral con el embed del builder, sin roles todavía', async () => {
    const interaction = makeCommandInteraction({ sub: 'crear' });

    await execute(interaction);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    const payload = interaction.reply.mock.calls[0][0];
    expect(payload.flags).toBeDefined();
    expect(payload.embeds[0].data.fields.find((f) => f.name.includes('Roles')).value).toContain('todavía no elegiste');
  });
});

describe('/rolreacciones crear — sesión expirada', () => {
  // userId propio (nunca usado por otro test de este archivo, ninguno de los cuales
  // limpia su sesión al terminar) — evita depender del orden de ejecución para que
  // esta key del Map en memoria esté realmente vacía.
  it('cada handler responde SESSION_EXPIRED si no hay sesión abierta', async () => {
    const rolesSelect = makeComponentInteraction({ customId: 'rrbuilder_roles_select', userId: 'user-sin-sesion', roles: [makeRole('role-a')] });
    await routeSelect(rolesSelect);
    expect(rolesSelect.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('expiró') }));

    const publish = makeComponentInteraction({ customId: 'rrbuilder_publish', userId: 'user-sin-sesion' });
    await routeButton(publish);
    expect(publish.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('expiró') }));
  });
});

describe('/rolreacciones crear — selección de roles', () => {
  it('roles válidos: actualiza el draft (visible en el render re-enviado)', async () => {
    await execute(makeCommandInteraction({ sub: 'crear' }));
    const roleA = makeRole('role-a', 'Gamer');

    const interaction = makeComponentInteraction({ customId: 'rrbuilder_roles_select', roles: [roleA] });
    await routeSelect(interaction);

    expect(interaction.update).toHaveBeenCalledTimes(1);
    const payload = interaction.update.mock.calls[0][0];
    expect(payload.embeds[0].data.fields.find((f) => f.name.includes('Roles')).value).toContain('role-a');
  });

  it('un rol inválido entre los elegidos: rechaza la selección completa, no llama a update', async () => {
    await execute(makeCommandInteraction({ sub: 'crear' }));
    getRoleValidationError.mockReturnValue('tiene el permiso **Administrador**');
    const roleA = makeRole('role-a', 'Peligroso');

    const interaction = makeComponentInteraction({ customId: 'rrbuilder_roles_select', roles: [roleA] });
    await routeSelect(interaction);

    expect(interaction.update).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Administrador') }));
  });

  it('preserva el emoji ya cargado al volver a elegir el mismo rol + uno nuevo', async () => {
    await execute(makeCommandInteraction({ sub: 'crear' }));
    const roleA = makeRole('role-a', 'Gamer');
    const roleB = makeRole('role-b', 'Artista');

    await routeSelect(makeComponentInteraction({ customId: 'rrbuilder_roles_select', roles: [roleA] }));
    await routeModal(makeModalInteraction({ customId: 'modal_rrbuilder_emojis', values: { emoji_0: '🎮' } }));
    await routeSelect(makeComponentInteraction({ customId: 'rrbuilder_roles_select', roles: [roleA, roleB] }));

    // Publica para inspeccionar el draft final vía el shape que le llega a createReactionRolePanel.
    await routeButton(makeComponentInteraction({ customId: 'rrbuilder_publish' }));

    expect(createReactionRolePanel).toHaveBeenCalledWith(
      'guild-1',
      'chan-invoking',
      'msg-nuevo',
      [
        { roleId: 'role-a', label: 'Gamer', emoji: '🎮' },
        { roleId: 'role-b', label: 'Artista', emoji: undefined },
      ],
      'user-1',
    );
  });
});

describe('/rolreacciones crear — canal', () => {
  it('elegir un canal en el selector lo guarda en el draft (visible en el render)', async () => {
    await execute(makeCommandInteraction({ sub: 'crear' }));
    const canal = { id: 'chan-elegido' };

    const interaction = makeComponentInteraction({ customId: 'rrbuilder_channel_select', channels: canal });
    await routeSelect(interaction);

    const payload = interaction.update.mock.calls[0][0];
    expect(payload.embeds[0].data.fields.find((f) => f.name.includes('Canal')).value).toBe('<#chan-elegido>');
  });
});

describe('/rolreacciones crear — título y descripción (modal)', () => {
  it('guarda título y descripción del modal en el draft', async () => {
    await execute(makeCommandInteraction({ sub: 'crear' }));

    const interaction = makeModalInteraction({ customId: 'modal_rrbuilder_content', values: { titulo: 'Colores', descripcion: 'Elegí tu color' } });
    await routeModal(interaction);

    const payload = interaction.update.mock.calls[0][0];
    expect(payload.embeds[0].data.title).toBe('Colores');
    expect(payload.embeds[0].data.description).toBe('Elegí tu color');
  });
});

describe('/rolreacciones crear — emojis (modal)', () => {
  it('el botón de emojis rechaza si todavía no hay roles elegidos', async () => {
    await execute(makeCommandInteraction({ sub: 'crear' }));

    const interaction = makeComponentInteraction({ customId: 'rrbuilder_emojis' });
    await routeButton(interaction);

    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Elegí roles primero') }));
  });

  it('con roles elegidos: abre el modal', async () => {
    await execute(makeCommandInteraction({ sub: 'crear' }));
    await routeSelect(makeComponentInteraction({ customId: 'rrbuilder_roles_select', roles: [makeRole('role-a', 'Gamer')] }));

    const interaction = makeComponentInteraction({ customId: 'rrbuilder_emojis' });
    await routeButton(interaction);

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
  });
});

describe('/rolreacciones crear — publicar', () => {
  it('sin roles elegidos: rechaza, no publica nada', async () => {
    await execute(makeCommandInteraction({ sub: 'crear' }));

    const interaction = makeComponentInteraction({ customId: 'rrbuilder_publish' });
    await routeButton(interaction);

    expect(createReactionRolePanel).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Elegí al menos un rol') }));
  });

  it('caso exitoso: publica en el canal por defecto, guarda la fila y confirma', async () => {
    await execute(makeCommandInteraction({ sub: 'crear' }));
    await routeSelect(makeComponentInteraction({ customId: 'rrbuilder_roles_select', roles: [makeRole('role-a', 'Gamer')] }));

    const interaction = makeComponentInteraction({ customId: 'rrbuilder_publish' });
    await routeButton(interaction);

    expect(interaction.channel.send).toHaveBeenCalledWith({ embeds: ['embed'], components: ['row'] });
    expect(createReactionRolePanel).toHaveBeenCalledWith('guild-1', 'chan-invoking', 'msg-nuevo', [{ roleId: 'role-a', label: 'Gamer', emoji: undefined }], 'user-1');
    expect(interaction.update).toHaveBeenCalledWith(expect.objectContaining({ content: '🎭 Publicando el panel...' }));
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('✅ Panel creado') }));
    expect(logConfigChange).toHaveBeenCalled();
  });

  // GIVE-1 (auditoría completa 2026-09-11, mismo bug class que /sorteo crear): si el
  // mensaje SÍ se posteó pero guardar la fila falla después, no puede quedar un panel
  // fantasma con botones que nunca van a encontrar una fila real.
  it('si createReactionRolePanel falla DESPUÉS de postear: borra el mensaje', async () => {
    await execute(makeCommandInteraction({ sub: 'crear' }));
    await routeSelect(makeComponentInteraction({ customId: 'rrbuilder_roles_select', roles: [makeRole('role-a', 'Gamer')] }));
    createReactionRolePanel.mockRejectedValueOnce(new Error('supabase timeout'));

    const sentMessage = { id: 'msg-nuevo', url: 'https://discord.com/channels/g/c/m', delete: vi.fn().mockResolvedValue(undefined) };
    const interaction = makeComponentInteraction({ customId: 'rrbuilder_publish', sendMessage: vi.fn().mockResolvedValue(sentMessage) });
    await routeButton(interaction);

    expect(sentMessage.delete).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No se pudo crear') }));
  });

  it('vuelve a publicar después de un fallo: la sesión sigue viva (no se borró)', async () => {
    await execute(makeCommandInteraction({ sub: 'crear' }));
    await routeSelect(makeComponentInteraction({ customId: 'rrbuilder_roles_select', roles: [makeRole('role-a', 'Gamer')] }));
    createReactionRolePanel.mockRejectedValueOnce(new Error('supabase timeout'));
    await routeButton(makeComponentInteraction({ customId: 'rrbuilder_publish' }));

    const interaction = makeComponentInteraction({ customId: 'rrbuilder_publish' });
    await routeButton(interaction);

    expect(createReactionRolePanel).toHaveBeenCalledTimes(2);
  });
});

describe('/rolreacciones crear — cancelar', () => {
  it('borra la sesión y confirma', async () => {
    await execute(makeCommandInteraction({ sub: 'crear' }));

    const interaction = makeComponentInteraction({ customId: 'rrbuilder_cancel' });
    await routeButton(interaction);

    expect(interaction.update).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Cancelado') }));

    // Sesión ya borrada: publicar después responde SESSION_EXPIRED, no "elegí un rol".
    const afterCancel = makeComponentInteraction({ customId: 'rrbuilder_publish' });
    await routeButton(afterCancel);
    expect(afterCancel.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('expiró') }));
  });
});

describe('/rolreacciones eliminar', () => {
  it('panel inexistente: avisa, no borra nada', async () => {
    getReactionRolePanel.mockResolvedValue(null);
    const interaction = makeCommandInteraction({ sub: 'eliminar' });

    await execute(interaction);

    expect(deleteReactionRolePanel).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No encontré') }));
  });

  it('panel existente: borra la fila y confirma (mensaje real ya no accesible: best-effort, no revienta)', async () => {
    getReactionRolePanel.mockResolvedValue({ guildId: 'guild-1', channelId: 'chan-1', messageId: 'msg-1', roles: [] });
    const interaction = makeCommandInteraction({ sub: 'eliminar' });

    await execute(interaction);

    expect(deleteReactionRolePanel).toHaveBeenCalledWith('guild-1', 'msg-1');
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('✅ Panel eliminado') }));
    expect(logConfigChange).toHaveBeenCalled();
  });
});

describe('/rolreacciones listar', () => {
  it('sin paneles: lo dice claro', async () => {
    listReactionRolePanels.mockResolvedValue([]);
    const interaction = makeCommandInteraction({ sub: 'listar' });

    await execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('todavía no tiene paneles') }));
  });

  it('con paneles: arma un embed con un campo por panel', async () => {
    listReactionRolePanels.mockResolvedValue([{ channelId: 'chan-1', messageId: 'msg-1', roles: [{ roleId: 'role-a' }] }]);
    const interaction = makeCommandInteraction({ sub: 'listar' });

    await execute(interaction);

    const payload = interaction.reply.mock.calls[0][0];
    expect(payload.embeds[0].data.fields).toHaveLength(1);
  });
});
