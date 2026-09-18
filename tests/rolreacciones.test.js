import { vi, describe, it, expect, beforeEach } from 'vitest';

// /rolreacciones (plan de ejecución 2026-09-15, ampliado en la auditoría NEXO V del
// 2026-09-18) — reaction-roles como panel de botones. `crear` es un builder interactivo
// (mismo patrón que /anuncio): sesión en memoria por guild+usuario, selects nativos de
// Discord (RoleSelectMenuBuilder/ChannelSelectMenuBuilder), texto vía modal, un render
// que se re-edita con interaction.update() en cada cambio. Desde el 2026-09-18 suma: un
// selector de emoji (Components V2 — StringSelectMenu DENTRO de un modal, con los
// emojis custom del servidor) con un modal manual encadenado de respaldo, e importar el
// panel completo pegando un JSON. Se ejercita a través de los routers REALES
// (routeButton/routeSelect/routeModal), nunca llamando a los handlers registrados a
// mano. asyncLock.js NO se mockea — el test de doble-click sobre "Publicar" depende del
// withLock real (mismo criterio que giveawayEngine.test.js).
const getRoleValidationError = vi.fn(() => null);
const createReactionRolePanel = vi.fn().mockResolvedValue(undefined);
const getReactionRolePanel = vi.fn();
const deleteReactionRolePanel = vi.fn().mockResolvedValue(undefined);
const listReactionRolePanels = vi.fn().mockResolvedValue([]);
const buildReactionRolePanelMessage = vi.fn(() => ({ embeds: ['embed'], components: ['row'] }));
vi.mock('../src/utils/reactionRolePanels.js', async () => {
  const actual = await vi.importActual('../src/utils/reactionRolePanels.js');
  return {
    MAX_ROLES_PER_PANEL: actual.MAX_ROLES_PER_PANEL,
    isValidEmojiInput: actual.isValidEmojiInput,
    extractCustomEmojiId: actual.extractCustomEmojiId,
    getRoleValidationError: (...a) => getRoleValidationError(...a),
    createReactionRolePanel: (...a) => createReactionRolePanel(...a),
    getReactionRolePanel: (...a) => getReactionRolePanel(...a),
    deleteReactionRolePanel: (...a) => deleteReactionRolePanel(...a),
    listReactionRolePanels: (...a) => listReactionRolePanels(...a),
    buildReactionRolePanelMessage: (...a) => buildReactionRolePanelMessage(...a),
  };
});

const logConfigChange = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/commands/admin/config.js', () => ({ logConfigChange: (...a) => logConfigChange(...a) }));

const { execute } = await import('../src/commands/admin/rolreacciones.js');
const { routeButton } = await import('../src/components/buttons.js');
const { routeSelect } = await import('../src/components/selects.js');
const { routeModal } = await import('../src/components/modals.js');

function makeRole(id, name = id) {
  return { id, name, toString: () => `<@&${id}>`, position: 1 };
}

function makeGuildEmoji(id, name, animated = false) {
  return { id, name, animated, toString: () => `<${animated ? 'a' : ''}:${name}:${id}>` };
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
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

// resolveRole: por defecto "cualquier ID existe" (auto-fabrica un rol con ese id) —
// los tests que necesitan simular "el rol ya no existe" pasan resolveRole: () => null.
function makeGuildStub({ guildId = 'guild-1', channelsFetchResult, resolveRole = (id) => makeRole(id), emojis = new Map() } = {}) {
  return {
    id: guildId,
    channels: { fetch: vi.fn().mockResolvedValue(channelsFetchResult ?? null) },
    roles: { cache: { get: resolveRole }, fetch: vi.fn().mockResolvedValue(null) },
    emojis: { cache: emojis, fetch: vi.fn().mockResolvedValue(emojis) },
  };
}

function makeComponentInteraction({ customId, guildId = 'guild-1', userId = 'user-1', roles = [], channels = null, sendMessage, resolveRole, emojis } = {}) {
  const publishedChannel = {
    id: 'chan-invoking',
    send: sendMessage || vi.fn().mockResolvedValue({ id: 'msg-nuevo', url: 'https://discord.com/channels/g/c/m', delete: vi.fn().mockResolvedValue(undefined) }),
  };
  return {
    customId,
    guildId,
    guild: { ...makeGuildStub({ guildId, channelsFetchResult: publishedChannel, resolveRole, emojis }) },
    channel: publishedChannel,
    user: { id: userId },
    roles, // Array.prototype.values() ya cubre el .values() que usa el handler
    channels: { first: () => channels },
    fields: { getTextInputValue: () => '', getStringSelectValues: () => [] },
    reply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    showModal: vi.fn().mockResolvedValue(undefined),
  };
}

function makeModalInteraction({ customId, guildId = 'guild-1', userId = 'user-1', values = {}, selectValues = {}, resolveRole, emojis } = {}) {
  const publishedChannel = { id: 'chan-invoking', send: vi.fn().mockResolvedValue({ id: 'msg-nuevo', url: 'https://discord.com/channels/g/c/m', delete: vi.fn().mockResolvedValue(undefined) }) };
  return {
    customId,
    guildId,
    guild: { ...makeGuildStub({ guildId, channelsFetchResult: publishedChannel, resolveRole, emojis }) },
    channel: publishedChannel,
    user: { id: userId },
    fields: {
      getTextInputValue: (name) => values[name] ?? '',
      getStringSelectValues: (name) => selectValues[name] ?? [],
    },
    reply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    showModal: vi.fn().mockResolvedValue(undefined),
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

  it('abrir un segundo builder sin terminar el primero invalida el mensaje viejo', async () => {
    const first = makeCommandInteraction({ sub: 'crear' });
    await execute(first);

    const second = makeCommandInteraction({ sub: 'crear' });
    await execute(second);

    expect(first.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('invalidado') }));
    expect(second.reply).toHaveBeenCalledTimes(1);
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
    await routeModal(makeModalInteraction({ customId: 'modal_rrbuilder_emoji_pick', selectValues: { emoji_pick_0: ['__manual__'] } }));
    await routeModal(makeModalInteraction({ customId: 'modal_rrbuilder_emoji_manual_0', values: { emoji_manual_0: '🎮' } }));
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

describe('/rolreacciones crear — emojis (selector + modal manual encadenado)', () => {
  it('el botón de emojis rechaza si todavía no hay roles elegidos', async () => {
    await execute(makeCommandInteraction({ sub: 'crear' }));

    const interaction = makeComponentInteraction({ customId: 'rrbuilder_emojis' });
    await routeButton(interaction);

    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Elegí roles primero') }));
  });

  it('con roles elegidos: abre el selector de emoji (trae los emojis del server en fresco)', async () => {
    await execute(makeCommandInteraction({ sub: 'crear' }));
    await routeSelect(makeComponentInteraction({ customId: 'rrbuilder_roles_select', roles: [makeRole('role-a', 'Gamer')] }));

    const emojis = new Map([['emoji-1', makeGuildEmoji('emoji-1', 'gamer')]]);
    const interaction = makeComponentInteraction({ customId: 'rrbuilder_emojis', emojis });
    await routeButton(interaction);

    expect(interaction.guild.emojis.fetch).toHaveBeenCalledTimes(1);
    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    expect(interaction.showModal.mock.calls[0][0].data.custom_id).toBe('modal_rrbuilder_emoji_pick');
  });

  it('elegir un emoji custom del server en el selector: lo guarda directo, sin segundo modal', async () => {
    await execute(makeCommandInteraction({ sub: 'crear' }));
    await routeSelect(makeComponentInteraction({ customId: 'rrbuilder_roles_select', roles: [makeRole('role-a', 'Gamer')] }));

    const emojis = new Map([['emoji-1', makeGuildEmoji('emoji-1', 'gamer')]]);
    const interaction = makeModalInteraction({ customId: 'modal_rrbuilder_emoji_pick', selectValues: { emoji_pick_0: ['emoji-1'] }, emojis });
    await routeModal(interaction);

    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(interaction.update).toHaveBeenCalledTimes(1);
    const payload = interaction.update.mock.calls[0][0];
    expect(payload.embeds[0].data.fields.find((f) => f.name.includes('Roles')).value).toContain('<:gamer:emoji-1>');
  });

  it('elegir "sin emoji" en el selector: limpia el emoji del rol', async () => {
    await execute(makeCommandInteraction({ sub: 'crear' }));
    await routeSelect(makeComponentInteraction({ customId: 'rrbuilder_roles_select', roles: [makeRole('role-a', 'Gamer')] }));
    await routeModal(makeModalInteraction({ customId: 'modal_rrbuilder_emoji_pick', selectValues: { emoji_pick_0: ['__manual__'] } }));
    await routeModal(makeModalInteraction({ customId: 'modal_rrbuilder_emoji_manual_0', values: { emoji_manual_0: '🎮' } }));

    await routeModal(makeModalInteraction({ customId: 'modal_rrbuilder_emoji_pick', selectValues: { emoji_pick_0: ['__none__'] } }));
    await routeButton(makeComponentInteraction({ customId: 'rrbuilder_publish' }));

    expect(createReactionRolePanel).toHaveBeenCalledWith('guild-1', 'chan-invoking', 'msg-nuevo', [{ roleId: 'role-a', label: 'Gamer', emoji: undefined }], 'user-1');
  });

  it('elegir "escribir manualmente": encadena un segundo modal solo para ese rol', async () => {
    await execute(makeCommandInteraction({ sub: 'crear' }));
    await routeSelect(makeComponentInteraction({ customId: 'rrbuilder_roles_select', roles: [makeRole('role-a', 'Gamer')] }));

    const interaction = makeModalInteraction({ customId: 'modal_rrbuilder_emoji_pick', selectValues: { emoji_pick_0: ['__manual__'] } });
    await routeModal(interaction);

    expect(interaction.update).not.toHaveBeenCalled();
    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    expect(interaction.showModal.mock.calls[0][0].data.custom_id).toBe('modal_rrbuilder_emoji_manual_0');
  });

  it('modal manual: aplica el emoji tipeado y refresca el builder original (no i.update, porque viene de un modal encadenado)', async () => {
    const owner = makeCommandInteraction({ sub: 'crear' });
    await execute(owner);
    await routeSelect(makeComponentInteraction({ customId: 'rrbuilder_roles_select', roles: [makeRole('role-a', 'Gamer')] }));

    const interaction = makeModalInteraction({ customId: 'modal_rrbuilder_emoji_manual_0', values: { emoji_manual_0: '🎮' } });
    await routeModal(interaction);

    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(owner.editReply).toHaveBeenCalledTimes(1);
    const payload = owner.editReply.mock.calls[0][0];
    expect(payload.embeds[0].data.fields.find((f) => f.name.includes('Roles')).value).toContain('🎮');
  });

  it('modal manual: emoji mal formado se rechaza identificando el rol, sin tocar el draft', async () => {
    await execute(makeCommandInteraction({ sub: 'crear' }));
    await routeSelect(makeComponentInteraction({ customId: 'rrbuilder_roles_select', roles: [makeRole('role-a', 'Gamer')] }));

    const interaction = makeModalInteraction({ customId: 'modal_rrbuilder_emoji_manual_0', values: { emoji_manual_0: 'no-es-emoji' } });
    await routeModal(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Gamer') }));
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
  });
});

describe('/rolreacciones crear — importar JSON', () => {
  it('JSON válido: carga título, descripción y roles en el draft (preview, no publica)', async () => {
    await execute(makeCommandInteraction({ sub: 'crear' }));

    const json = JSON.stringify({ titulo: 'Elegí tu juego', descripcion: 'Click para sumarte', roles: [{ rol: 'role-a', emoji: '🎮', etiqueta: 'Gamer' }] });
    const interaction = makeModalInteraction({ customId: 'modal_rrbuilder_json', values: { json } });
    await routeModal(interaction);

    expect(createReactionRolePanel).not.toHaveBeenCalled();
    const payload = interaction.update.mock.calls[0][0];
    expect(payload.embeds[0].data.title).toBe('Elegí tu juego');
    expect(payload.embeds[0].data.fields.find((f) => f.name.includes('Roles')).value).toContain('🎮');
  });

  it('JSON con sintaxis inválida: rechaza sin tocar el draft', async () => {
    await execute(makeCommandInteraction({ sub: 'crear' }));

    const interaction = makeModalInteraction({ customId: 'modal_rrbuilder_json', values: { json: '{roles: [' } });
    await routeModal(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('JSON válido') }));
    expect(interaction.update).not.toHaveBeenCalled();
  });

  it('JSON con más roles que el máximo permitido: rechaza', async () => {
    await execute(makeCommandInteraction({ sub: 'crear' }));
    const roles = Array.from({ length: 6 }, (_, i) => ({ rol: `role-${i}` }));

    const interaction = makeModalInteraction({ customId: 'modal_rrbuilder_json', values: { json: JSON.stringify({ roles }) } });
    await routeModal(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Máximo') }));
  });

  it('JSON con un ID de rol que no existe en el servidor: rechaza identificando el elemento', async () => {
    await execute(makeCommandInteraction({ sub: 'crear' }));

    const interaction = makeModalInteraction({
      customId: 'modal_rrbuilder_json',
      values: { json: JSON.stringify({ roles: [{ rol: 'role-fantasma' }] }) },
      resolveRole: () => null,
    });
    await routeModal(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No encontré') }));
  });

  it('JSON con un rol peligroso: rechaza igual que el selector nativo', async () => {
    await execute(makeCommandInteraction({ sub: 'crear' }));
    getRoleValidationError.mockReturnValue('tiene el permiso **Administrador**');

    const interaction = makeModalInteraction({ customId: 'modal_rrbuilder_json', values: { json: JSON.stringify({ roles: [{ rol: 'role-a' }] }) } });
    await routeModal(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Administrador') }));
  });

  it('JSON con un emoji mal formado: rechaza identificando el rol', async () => {
    await execute(makeCommandInteraction({ sub: 'crear' }));

    const interaction = makeModalInteraction({ customId: 'modal_rrbuilder_json', values: { json: JSON.stringify({ roles: [{ rol: 'role-a', emoji: 'no-es-emoji' }] }) } });
    await routeModal(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('emoji') }));
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

  // Auditoría NEXO V (2026-09-18): revalidación en fresco justo antes de publicar — un
  // rol puede haberse borrado entre elegirlo y publicar.
  it('si un rol ya no existe al momento de publicar: rechaza sin crear el panel', async () => {
    await execute(makeCommandInteraction({ sub: 'crear' }));
    await routeSelect(makeComponentInteraction({ customId: 'rrbuilder_roles_select', roles: [makeRole('role-a', 'Gamer')] }));

    const interaction = makeComponentInteraction({ customId: 'rrbuilder_publish', resolveRole: () => null });
    await routeButton(interaction);

    expect(createReactionRolePanel).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('ya no existe') }));
  });

  it('si un rol se volvió peligroso al momento de publicar: rechaza sin crear el panel', async () => {
    await execute(makeCommandInteraction({ sub: 'crear' }));
    await routeSelect(makeComponentInteraction({ customId: 'rrbuilder_roles_select', roles: [makeRole('role-a', 'Gamer')] }));
    getRoleValidationError.mockReturnValue('tiene el permiso **Administrador**');

    const interaction = makeComponentInteraction({ customId: 'rrbuilder_publish' });
    await routeButton(interaction);

    expect(createReactionRolePanel).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Administrador') }));
  });

  // Auditoría NEXO V (2026-09-18): dos clicks casi simultáneos sobre "Publicar" no deben
  // crear dos paneles — withLock real (sin mockear) serializa las dos ejecuciones.
  it('dos clicks casi simultáneos en Publicar: crea un solo panel, nunca dos', async () => {
    await execute(makeCommandInteraction({ sub: 'crear' }));
    await routeSelect(makeComponentInteraction({ customId: 'rrbuilder_roles_select', roles: [makeRole('role-a', 'Gamer')] }));

    const first = makeComponentInteraction({ customId: 'rrbuilder_publish' });
    const second = makeComponentInteraction({ customId: 'rrbuilder_publish' });
    await Promise.all([routeButton(first), routeButton(second)]);

    expect(createReactionRolePanel).toHaveBeenCalledTimes(1);
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
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No encontré') }));
  });

  // Auditoría NEXO V (2026-09-18): defer ANTES de fetch/edit/borrado — sin esto, la
  // ventana de 3s del token podía vencer con el panel YA borrado.
  it('panel existente: hace defer antes de tocar Discord/Supabase, borra la fila y confirma con editReply', async () => {
    getReactionRolePanel.mockResolvedValue({ guildId: 'guild-1', channelId: 'chan-1', messageId: 'msg-1', roles: [] });
    const interaction = makeCommandInteraction({ sub: 'eliminar' });

    await execute(interaction);

    expect(interaction.deferReply).toHaveBeenCalledTimes(1);
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(deleteReactionRolePanel).toHaveBeenCalledWith('guild-1', 'msg-1');
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('✅ Panel eliminado') }));
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
