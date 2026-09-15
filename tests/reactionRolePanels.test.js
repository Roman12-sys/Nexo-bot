import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import { createSupabaseMock } from './helpers/supabaseMock.js';

// Reaction-roles como panel de botones (plan de ejecución 2026-09-15) — P1 de Fase 4B.
// getRoleValidationError es la única fuente de verdad de "¿NEXO puede asignar este rol
// ahora mismo?", usada tanto al crear el panel como en cada click (revalidación en
// vivo, mismo criterio que resolveLiveSelfRoles en selfRoles.js).
const supabaseMock = createSupabaseMock();
vi.mock('../src/supabaseClient.js', () => ({
  get supabase() {
    return supabaseMock;
  },
}));

const {
  createReactionRolePanel,
  getReactionRolePanel,
  deleteReactionRolePanel,
  listReactionRolePanels,
  getRoleValidationError,
  buildReactionRolePanelMessage,
  BUTTON_PREFIX,
} = await import('../src/utils/reactionRolePanels.js');
const { routeButton } = await import('../src/components/buttons.js');

function makeRole(id, { name = id, permissionBits = 0n, position = 1 } = {}) {
  return { id, name, position, permissions: { has: (flag) => (permissionBits & flag) === flag } };
}

function makeGuild({ id = 'guild-1', roles = [], botPosition = 100, botHasManageRoles = true, hasMe = true } = {}) {
  const byId = new Map(roles.map((r) => [r.id, r]));
  return {
    id,
    members: {
      me: hasMe ? { permissions: { has: () => botHasManageRoles }, roles: { highest: { position: botPosition } } } : null,
    },
    roles: {
      cache: byId,
      fetch: vi.fn(async (roleId) => byId.get(roleId) || null),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('store CRUD', () => {
  it('createReactionRolePanel inserta la fila con las columnas esperadas', async () => {
    supabaseMock.getBuilder('reaction_role_panels').__setResult({ error: null });
    const roles = [{ roleId: 'role-a', label: 'Gamer' }];

    await createReactionRolePanel('guild-1', 'chan-1', 'msg-1', roles, 'admin-1');

    expect(supabaseMock.getBuilder('reaction_role_panels').insert).toHaveBeenCalledWith({
      guild_id: 'guild-1',
      channel_id: 'chan-1',
      message_id: 'msg-1',
      roles,
      created_by: 'admin-1',
    });
  });

  it('getReactionRolePanel devuelve null si no existe', async () => {
    supabaseMock.getBuilder('reaction_role_panels').__setResult({ data: null, error: null });

    expect(await getReactionRolePanel('guild-1', 'msg-1')).toBeNull();
  });

  it('getReactionRolePanel mapea la fila real', async () => {
    supabaseMock.getBuilder('reaction_role_panels').__setResult({
      data: { id: 'uuid-1', guild_id: 'guild-1', channel_id: 'chan-1', message_id: 'msg-1', roles: [{ roleId: 'role-a', label: 'Gamer' }], created_by: 'admin-1', created_at: '2026-09-15T00:00:00Z' },
      error: null,
    });

    const panel = await getReactionRolePanel('guild-1', 'msg-1');

    expect(panel).toEqual({
      id: 'uuid-1',
      guildId: 'guild-1',
      channelId: 'chan-1',
      messageId: 'msg-1',
      roles: [{ roleId: 'role-a', label: 'Gamer' }],
      createdBy: 'admin-1',
      createdAt: '2026-09-15T00:00:00Z',
    });
  });

  it('deleteReactionRolePanel borra por guild+message', async () => {
    supabaseMock.getBuilder('reaction_role_panels').__setResult({ error: null });

    await deleteReactionRolePanel('guild-1', 'msg-1');

    expect(supabaseMock.getBuilder('reaction_role_panels').delete).toHaveBeenCalled();
    expect(supabaseMock.getBuilder('reaction_role_panels').eq).toHaveBeenCalledWith('guild_id', 'guild-1');
  });

  it('listReactionRolePanels devuelve [] si no hay paneles', async () => {
    supabaseMock.getBuilder('reaction_role_panels').__setResult({ data: null, error: null });

    expect(await listReactionRolePanels('guild-1')).toEqual([]);
  });

  it('un error de Postgres se propaga en las 4 funciones', async () => {
    const dbError = new Error('boom');
    supabaseMock.getBuilder('reaction_role_panels').__setResult({ data: null, error: dbError });

    await expect(createReactionRolePanel('g', 'c', 'm', [], 'u')).rejects.toBe(dbError);
    await expect(getReactionRolePanel('g', 'm')).rejects.toBe(dbError);
    await expect(deleteReactionRolePanel('g', 'm')).rejects.toBe(dbError);
    await expect(listReactionRolePanels('g')).rejects.toBe(dbError);
  });
});

describe('getRoleValidationError', () => {
  it('null si el rol es seguro y el bot puede asignarlo', () => {
    const safe = makeRole('role-a', { position: 1 });
    const guild = makeGuild({ roles: [safe] });

    expect(getRoleValidationError(guild, safe)).toBeNull();
  });

  it('rechaza un rol con permiso peligroso', () => {
    const dangerous = makeRole('role-a', { permissionBits: PermissionFlagsBits.Administrator });
    const guild = makeGuild({ roles: [dangerous] });

    expect(getRoleValidationError(guild, dangerous)).toContain('Administrador');
  });

  it('rechaza un rol en o por encima del rol más alto del bot', () => {
    const tooHigh = makeRole('role-a', { position: 200 });
    const guild = makeGuild({ roles: [tooHigh], botPosition: 100 });

    expect(getRoleValidationError(guild, tooHigh)).not.toBeNull();
  });

  it('rechaza si el bot no tiene Gestionar roles', () => {
    const safe = makeRole('role-a', { position: 1 });
    const guild = makeGuild({ roles: [safe], botHasManageRoles: false });

    expect(getRoleValidationError(guild, safe)).not.toBeNull();
  });
});

describe('buildReactionRolePanelMessage', () => {
  it('título por defecto y un botón por rol con el customId correcto', () => {
    const { embeds, components } = buildReactionRolePanelMessage({
      titulo: null,
      descripcion: null,
      roles: [{ roleId: 'role-a', label: 'Gamer' }, { roleId: 'role-b', label: 'Artista' }],
    });

    expect(embeds[0].data.title).toBe('🎭 Elegí tus roles');
    const buttons = components[0].toJSON().components;
    expect(buttons).toHaveLength(2);
    expect(buttons[0].custom_id).toBe(`${BUTTON_PREFIX}role-a`);
    expect(buttons[0].label).toBe('Gamer');
  });

  it('usa el título/descripción provistos', () => {
    const { embeds } = buildReactionRolePanelMessage({ titulo: 'Colores', descripcion: 'Elegí tu color', roles: [{ roleId: 'role-a', label: 'Rojo' }] });

    expect(embeds[0].data.title).toBe('Colores');
    expect(embeds[0].data.description).toBe('Elegí tu color');
  });
});

function makePanelInteraction({ guild, messageId = 'msg-1', roleId, memberHasRole = false }) {
  return {
    guildId: guild.id,
    guild,
    customId: `${BUTTON_PREFIX}${roleId}`,
    message: { id: messageId },
    member: { roles: { cache: memberHasRole ? new Map([[roleId, {}]]) : new Map(), add: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) } },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

describe(`${BUTTON_PREFIX} — handler (toggle de reaction-roles)`, () => {
  it('panel inexistente: avisa y no toca roles', async () => {
    supabaseMock.getBuilder('reaction_role_panels').__setResult({ data: null, error: null });
    const guild = makeGuild({ roles: [makeRole('role-a')] });
    const interaction = makePanelInteraction({ guild, roleId: 'role-a' });

    await routeButton(interaction);

    expect(interaction.member.roles.add).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('ya no es válido') }));
  });

  it('el rol clickeado ya no forma parte del panel: rechaza', async () => {
    supabaseMock.getBuilder('reaction_role_panels').__setResult({
      data: { guild_id: 'guild-1', channel_id: 'c', message_id: 'msg-1', roles: [{ roleId: 'role-b', label: 'Otro' }], created_by: 'u', created_at: 'x' },
      error: null,
    });
    const guild = makeGuild({ roles: [makeRole('role-a')] });
    const interaction = makePanelInteraction({ guild, roleId: 'role-a' });

    await routeButton(interaction);

    expect(interaction.member.roles.add).not.toHaveBeenCalled();
  });

  it('el rol ya no existe en el servidor: rechaza sin reventar', async () => {
    supabaseMock.getBuilder('reaction_role_panels').__setResult({
      data: { guild_id: 'guild-1', channel_id: 'c', message_id: 'msg-1', roles: [{ roleId: 'role-borrado', label: 'X' }], created_by: 'u', created_at: 'x' },
      error: null,
    });
    const guild = makeGuild({ roles: [] });
    const interaction = makePanelInteraction({ guild, roleId: 'role-borrado' });

    await routeButton(interaction);

    expect(interaction.member.roles.add).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('ya no existe') }));
  });

  // Mismo hallazgo que el riesgo arquitectónico cerrado en punish.js/guildMemberAdd.js:
  // un rol puede volverse peligroso DESPUÉS de crear el panel — se revalida en vivo.
  it('el rol se volvió peligroso después de crear el panel: rechaza, no asigna', async () => {
    const dangerous = makeRole('role-a', { name: 'Ahora Admin', permissionBits: PermissionFlagsBits.Administrator });
    supabaseMock.getBuilder('reaction_role_panels').__setResult({
      data: { guild_id: 'guild-1', channel_id: 'c', message_id: 'msg-1', roles: [{ roleId: 'role-a', label: 'Gamer' }], created_by: 'u', created_at: 'x' },
      error: null,
    });
    const guild = makeGuild({ roles: [dangerous] });
    const interaction = makePanelInteraction({ guild, roleId: 'role-a' });

    await routeButton(interaction);

    expect(interaction.member.roles.add).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Administrador') }));
  });

  it('el member no tiene el rol: lo agrega', async () => {
    const role = makeRole('role-a', { name: 'Gamer' });
    supabaseMock.getBuilder('reaction_role_panels').__setResult({
      data: { guild_id: 'guild-1', channel_id: 'c', message_id: 'msg-1', roles: [{ roleId: 'role-a', label: 'Gamer' }], created_by: 'u', created_at: 'x' },
      error: null,
    });
    const guild = makeGuild({ roles: [role] });
    const interaction = makePanelInteraction({ guild, roleId: 'role-a', memberHasRole: false });

    await routeButton(interaction);

    expect(interaction.member.roles.add).toHaveBeenCalledWith('role-a');
    expect(interaction.member.roles.remove).not.toHaveBeenCalled();
  });

  it('el member ya tiene el rol: lo quita (toggle)', async () => {
    const role = makeRole('role-a', { name: 'Gamer' });
    supabaseMock.getBuilder('reaction_role_panels').__setResult({
      data: { guild_id: 'guild-1', channel_id: 'c', message_id: 'msg-1', roles: [{ roleId: 'role-a', label: 'Gamer' }], created_by: 'u', created_at: 'x' },
      error: null,
    });
    const guild = makeGuild({ roles: [role] });
    const interaction = makePanelInteraction({ guild, roleId: 'role-a', memberHasRole: true });

    await routeButton(interaction);

    expect(interaction.member.roles.remove).toHaveBeenCalledWith('role-a');
    expect(interaction.member.roles.add).not.toHaveBeenCalled();
  });
});
