import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';

// src/utils/selfRoles.js (CICLO 1, Mejora 2/2) — roles autoasignables. resolveLiveSelfRoles
// es la única fuente de verdad de "qué roles están disponibles AHORA": nunca confía en
// los IDs crudos de guild_config, revalida existencia + permiso peligroso + jerarquía
// contra el servidor real cada vez que se llama.
const getGuildConfig = vi.fn();
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig }));

const { resolveLiveSelfRoles, buildSelfRolesMessage } = await import('../src/utils/selfRoles.js');
const { routeSelect } = await import('../src/components/selects.js');

function makeRole(id, { name = id, permissionBits = 0n, position = 1 } = {}) {
  return { id, name, position, permissions: { has: (flag) => (permissionBits & flag) === flag } };
}

function makeGuild({ id = 'guild-1', roles = [], botPosition = 100, botHasManageRoles = true, hasMe = true } = {}) {
  const byId = new Map(roles.map((r) => [r.id, r]));
  return {
    id,
    members: {
      me: hasMe
        ? { permissions: { has: () => botHasManageRoles }, roles: { highest: { position: botPosition } } }
        : null,
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

describe('resolveLiveSelfRoles', () => {
  it('sin ningún rol configurado: [] sin tocar guild.roles', async () => {
    getGuildConfig.mockResolvedValue({ selfassignable_roles: [] });
    const guild = makeGuild({ roles: [] });

    const roles = await resolveLiveSelfRoles(guild);

    expect(roles).toEqual([]);
    expect(guild.roles.fetch).not.toHaveBeenCalled();
  });

  it('filtra un rol borrado (ya no está en el server)', async () => {
    getGuildConfig.mockResolvedValue({ selfassignable_roles: ['role-borrado'] });
    const guild = makeGuild({ roles: [] });

    const roles = await resolveLiveSelfRoles(guild);

    expect(roles).toEqual([]);
  });

  it('filtra un rol con un permiso peligroso (defensa en profundidad)', async () => {
    const dangerous = makeRole('role-admin', { permissionBits: PermissionFlagsBits.Administrator });
    getGuildConfig.mockResolvedValue({ selfassignable_roles: ['role-admin'] });
    const guild = makeGuild({ roles: [dangerous] });

    const roles = await resolveLiveSelfRoles(guild);

    expect(roles).toEqual([]);
  });

  it('filtra un rol en o por encima del rol más alto del bot (no lo podría asignar)', async () => {
    const tooHigh = makeRole('role-alto', { position: 200 });
    getGuildConfig.mockResolvedValue({ selfassignable_roles: ['role-alto'] });
    const guild = makeGuild({ roles: [tooHigh], botPosition: 100 });

    const roles = await resolveLiveSelfRoles(guild);

    expect(roles).toEqual([]);
  });

  it('filtra todo si el bot no tiene el permiso Gestionar roles', async () => {
    const safe = makeRole('role-normal', { position: 1 });
    getGuildConfig.mockResolvedValue({ selfassignable_roles: ['role-normal'] });
    const guild = makeGuild({ roles: [safe], botHasManageRoles: false });

    const roles = await resolveLiveSelfRoles(guild);

    expect(roles).toEqual([]);
  });

  it('sin guild.members.me disponible: [] (no arriesga, no revienta)', async () => {
    const safe = makeRole('role-normal', { position: 1 });
    getGuildConfig.mockResolvedValue({ selfassignable_roles: ['role-normal'] });
    const guild = makeGuild({ roles: [safe], hasMe: false });

    await expect(resolveLiveSelfRoles(guild)).resolves.toEqual([]);
  });

  it('devuelve exactamente los roles seguros, en el mismo orden que guild_config', async () => {
    const roleA = makeRole('role-a', { position: 1 });
    const roleB = makeRole('role-b', { position: 2 });
    const dangerous = makeRole('role-c', { permissionBits: PermissionFlagsBits.ManageRoles, position: 3 });
    getGuildConfig.mockResolvedValue({ selfassignable_roles: ['role-a', 'role-c', 'role-b'] });
    const guild = makeGuild({ roles: [roleA, roleB, dangerous], botPosition: 100 });

    const roles = await resolveLiveSelfRoles(guild);

    expect(roles.map((r) => r.id)).toEqual(['role-a', 'role-b']);
  });
});

describe('buildSelfRolesMessage', () => {
  it('sin roles disponibles: devuelve null', async () => {
    getGuildConfig.mockResolvedValue({ selfassignable_roles: [] });
    const guild = makeGuild({ roles: [] });

    expect(await buildSelfRolesMessage(guild)).toBeNull();
  });

  it('con roles disponibles: arma un select menu con las opciones correctas', async () => {
    const roleA = makeRole('role-a', { name: 'Gamer', position: 1 });
    const roleB = makeRole('role-b', { name: 'Artista', position: 2 });
    getGuildConfig.mockResolvedValue({ selfassignable_roles: ['role-a', 'role-b'] });
    const guild = makeGuild({ roles: [roleA, roleB] });

    const message = await buildSelfRolesMessage(guild);

    expect(message).not.toBeNull();
    const json = message.components[0].toJSON();
    expect(json.components[0].options).toEqual([
      { label: 'Gamer', value: 'role-a', default: false },
      { label: 'Artista', value: 'role-b', default: false },
    ]);
    expect(json.components[0].min_values).toBe(0);
    expect(json.components[0].max_values).toBe(2);
  });

  it('con un member: preselecciona (.default=true) los roles que ya tiene', async () => {
    const roleA = makeRole('role-a', { name: 'Gamer' });
    const roleB = makeRole('role-b', { name: 'Artista' });
    getGuildConfig.mockResolvedValue({ selfassignable_roles: ['role-a', 'role-b'] });
    const guild = makeGuild({ roles: [roleA, roleB] });
    const member = { roles: { cache: new Map([['role-a', roleA]]) } };

    const message = await buildSelfRolesMessage(guild, member);

    const options = message.components[0].toJSON().components[0].options;
    expect(options.find((o) => o.value === 'role-a').default).toBe(true);
    expect(options.find((o) => o.value === 'role-b').default).toBe(false);
  });
});

// El handler se registra como efecto secundario al importar el módulo — se ejercita a
// través del router REAL (routeSelect), igual criterio que el resto del proyecto para
// componentes (ver setupRoleSafety.test.js, encuesta.test.js).
function makeSelectInteraction({ guild, values, memberRoleIds = [] }) {
  return {
    customId: 'selfroles_select',
    guild,
    values,
    member: { roles: { cache: new Map(memberRoleIds.map((id) => [id, {}])), add: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) },
    },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('selfroles_select — handler (seguridad + comportamiento)', () => {
  it('agrega los roles seleccionados que el member no tenía', async () => {
    const roleA = makeRole('role-a', { name: 'Gamer' });
    const roleB = makeRole('role-b', { name: 'Artista' });
    getGuildConfig.mockResolvedValue({ selfassignable_roles: ['role-a', 'role-b'] });
    const guild = makeGuild({ roles: [roleA, roleB] });
    const interaction = makeSelectInteraction({ guild, values: ['role-a'], memberRoleIds: [] });

    const handled = await routeSelect(interaction);

    expect(handled).toBe(true);
    expect(interaction.member.roles.add).toHaveBeenCalledWith([roleA]);
    expect(interaction.member.roles.remove).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Agregado: Gamer') }));
  });

  it('quita los roles deseleccionados que el member ya tenía', async () => {
    const roleA = makeRole('role-a', { name: 'Gamer' });
    getGuildConfig.mockResolvedValue({ selfassignable_roles: ['role-a'] });
    const guild = makeGuild({ roles: [roleA] });
    const interaction = makeSelectInteraction({ guild, values: [], memberRoleIds: ['role-a'] });

    await routeSelect(interaction);

    expect(interaction.member.roles.remove).toHaveBeenCalledWith([roleA]);
    expect(interaction.member.roles.add).not.toHaveBeenCalled();
  });

  it('sin cambios (ya tiene exactamente lo elegido): no llama add/remove, lo dice claro', async () => {
    const roleA = makeRole('role-a', { name: 'Gamer' });
    getGuildConfig.mockResolvedValue({ selfassignable_roles: ['role-a'] });
    const guild = makeGuild({ roles: [roleA] });
    const interaction = makeSelectInteraction({ guild, values: ['role-a'], memberRoleIds: ['role-a'] });

    await routeSelect(interaction);

    expect(interaction.member.roles.add).not.toHaveBeenCalled();
    expect(interaction.member.roles.remove).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Sin cambios') }));
  });

  it('seguridad: un value que ya no está en la lista viva (admin lo sacó después de mandar el menú) se ignora', async () => {
    const roleA = makeRole('role-a', { name: 'Gamer' });
    // guild_config YA NO tiene 'role-b' — simula que se sacó de la lista después de que
    // el menú (con la opción vieja) se mandó. El value llega igual porque Discord no
    // sabe que cambió, pero el handler revalida fresco.
    getGuildConfig.mockResolvedValue({ selfassignable_roles: ['role-a'] });
    const guild = makeGuild({ roles: [roleA] });
    const interaction = makeSelectInteraction({ guild, values: ['role-a', 'role-b'], memberRoleIds: [] });

    await routeSelect(interaction);

    expect(interaction.member.roles.add).toHaveBeenCalledWith([roleA]); // nunca role-b
  });

  it('seguridad: si un rol se vuelve peligroso después de whitelistearlo, se filtra en el click, no se asigna', async () => {
    const nowDangerous = makeRole('role-a', { name: 'Gamer', permissionBits: PermissionFlagsBits.Administrator });
    getGuildConfig.mockResolvedValue({ selfassignable_roles: ['role-a'] });
    const guild = makeGuild({ roles: [nowDangerous] });
    const interaction = makeSelectInteraction({ guild, values: ['role-a'], memberRoleIds: [] });

    await routeSelect(interaction);

    expect(interaction.member.roles.add).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Ya no hay roles autoasignables') }));
  });

  it('si Discord rechaza la asignación (permiso/rate limit), avisa sin reventar', async () => {
    const roleA = makeRole('role-a', { name: 'Gamer' });
    getGuildConfig.mockResolvedValue({ selfassignable_roles: ['role-a'] });
    const guild = makeGuild({ roles: [roleA] });
    const interaction = makeSelectInteraction({ guild, values: ['role-a'], memberRoleIds: [] });
    interaction.member.roles.add = vi.fn().mockRejectedValue(new Error('Missing Permissions'));

    await expect(routeSelect(interaction)).resolves.toBe(true);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No se pudieron actualizar') }));
  });
});
