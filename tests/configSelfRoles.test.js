import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';

// /config rol-autoasignable-agregar/quitar (CICLO 1, Mejora 2/2) — mismo criterio de
// seguridad que rol-castigo/rol-automatico (ver configRoleSafety.test.js): rechaza
// cualquier rol con un permiso peligroso ANTES de guardar, y acá además valida que el
// bot pueda asignarlo de verdad (jerarquía) — algo que rol-castigo/rol-automatico no
// necesitan validar en /config porque son roles que asigna el BOT solo más tarde, nunca
// en el momento de configurarlos.
const getGuildConfig = vi.fn();
const setGuildConfig = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig, setGuildConfig }));

const getGuildLogChannel = vi.fn();
vi.mock('../src/utils/guildLogChannels.js', () => ({ getGuildLogChannel }));

const { execute } = await import('../src/commands/admin/config.js');

function makeRole(id, { permissionBits = 0n, position = 1 } = {}) {
  return { id, toString: () => `<@&${id}>`, position, permissions: { has: (flag) => (permissionBits & flag) === flag } };
}

function makeInteraction({ subcommand, role = null, botPosition = 100, botHasManageRoles = true }) {
  return {
    guild: {
      ownerId: 'user-1',
      members: { me: { permissions: { has: () => botHasManageRoles }, roles: { highest: { position: botPosition } } } },
    },
    member: { permissions: { has: () => true } },
    user: { id: 'user-1', tag: 'admin#0001' },
    guildId: 'guild-1',
    client: {},
    options: {
      getSubcommand: () => subcommand,
      getRole: () => role,
      getChannel: () => null,
      getInteger: () => null,
      getString: () => null,
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
  getGuildConfig.mockResolvedValue({ selfassignable_roles: [] });
});

describe('/config rol-autoasignable-agregar', () => {
  it('un rol normal se agrega a la lista', async () => {
    const rol = makeRole('role-normal');
    const interaction = makeInteraction({ subcommand: 'rol-autoasignable-agregar', role: rol });

    await execute(interaction);

    expect(setGuildConfig).toHaveBeenCalledWith('guild-1', { selfassignable_roles: ['role-normal'] });
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('✅') }));
    expect(logChannel.send).toHaveBeenCalledTimes(1);
  });

  it('un rol con Administrator se rechaza — no se guarda nada', async () => {
    const rol = makeRole('role-admin', { permissionBits: PermissionFlagsBits.Administrator });
    const interaction = makeInteraction({ subcommand: 'rol-autoasignable-agregar', role: rol });

    await execute(interaction);

    expect(setGuildConfig).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Administrador') }));
  });

  it('un rol con Gestionar roles también se rechaza (no es solo Administrator)', async () => {
    const rol = makeRole('role-manage', { permissionBits: PermissionFlagsBits.ManageRoles });
    const interaction = makeInteraction({ subcommand: 'rol-autoasignable-agregar', role: rol });

    await execute(interaction);

    expect(setGuildConfig).not.toHaveBeenCalled();
  });

  it('un rol en o por encima del rol más alto del bot se rechaza (el bot no podría asignarlo)', async () => {
    const rol = makeRole('role-alto', { position: 150 });
    const interaction = makeInteraction({ subcommand: 'rol-autoasignable-agregar', role: rol, botPosition: 100 });

    await execute(interaction);

    expect(setGuildConfig).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('posición') }));
  });

  it('sin el permiso Gestionar roles el bot: se rechaza igual', async () => {
    const rol = makeRole('role-normal');
    const interaction = makeInteraction({ subcommand: 'rol-autoasignable-agregar', role: rol, botHasManageRoles: false });

    await execute(interaction);

    expect(setGuildConfig).not.toHaveBeenCalled();
  });

  it('un rol que ya está en la lista: avisa, no lo duplica', async () => {
    getGuildConfig.mockResolvedValue({ selfassignable_roles: ['role-ya-existe'] });
    const rol = makeRole('role-ya-existe');
    const interaction = makeInteraction({ subcommand: 'rol-autoasignable-agregar', role: rol });

    await execute(interaction);

    expect(setGuildConfig).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('ya está') }));
  });

  it('con 25 roles ya configurados: rechaza el 26to (límite real del select menu de Discord)', async () => {
    const existing = Array.from({ length: 25 }, (_, i) => `role-${i}`);
    getGuildConfig.mockResolvedValue({ selfassignable_roles: existing });
    const rol = makeRole('role-26');
    const interaction = makeInteraction({ subcommand: 'rol-autoasignable-agregar', role: rol });

    await execute(interaction);

    expect(setGuildConfig).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('25') }));
  });

  it('un rol peligroso rechazado no genera ningún log de configuración', async () => {
    const rol = makeRole('role-admin', { permissionBits: PermissionFlagsBits.Administrator });
    const interaction = makeInteraction({ subcommand: 'rol-autoasignable-agregar', role: rol });

    await execute(interaction);

    expect(logChannel.send).not.toHaveBeenCalled();
  });
});

describe('/config rol-autoasignable-quitar', () => {
  it('saca un rol existente de la lista', async () => {
    getGuildConfig.mockResolvedValue({ selfassignable_roles: ['role-a', 'role-b'] });
    const rol = makeRole('role-a');
    const interaction = makeInteraction({ subcommand: 'rol-autoasignable-quitar', role: rol });

    await execute(interaction);

    expect(setGuildConfig).toHaveBeenCalledWith('guild-1', { selfassignable_roles: ['role-b'] });
    expect(logChannel.send).toHaveBeenCalledTimes(1);
  });

  it('un rol que no estaba en la lista: avisa, no rompe nada', async () => {
    getGuildConfig.mockResolvedValue({ selfassignable_roles: ['role-b'] });
    const rol = makeRole('role-a');
    const interaction = makeInteraction({ subcommand: 'rol-autoasignable-quitar', role: rol });

    await execute(interaction);

    expect(setGuildConfig).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('no estaba') }));
  });
});
