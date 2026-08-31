import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';

// FASE 1 (auditoría de seguridad/economía, 2026-08-30) — /config rol-castigo y
// /config rol-automatico aceptaban CUALQUIER rol del selector, incluido uno con
// Administrator (o cualquier otro permiso peligroso real). rol-automatico se lo entrega
// a CADA miembro nuevo que se une (guildMemberAdd.js); rol-castigo se lo agrega punish.js
// a un usuario sancionado — en los dos casos, elegir por error el rol equivocado en el
// dropdown es una escalada de privilegios accidental. getDangerousRolePermission()
// (src/utils/permissions.js) es la validación central que ahora corre ANTES de guardar.
const getGuildConfig = vi.fn();
const setGuildConfig = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig, setGuildConfig }));

const getGuildLogChannel = vi.fn();
vi.mock('../src/utils/guildLogChannels.js', () => ({ getGuildLogChannel }));

const { execute } = await import('../src/commands/admin/config.js');

function makeRole(id, permissionBits = 0n) {
  return {
    id,
    toString: () => `<@&${id}>`,
    permissions: { has: (flag) => (permissionBits & flag) === flag },
  };
}

function makeInteraction({ subcommand, role = null }) {
  return {
    guild: { ownerId: 'user-1' },
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
});

describe.each([
  ['rol-castigo', 'punish_role_id'],
  ['rol-automatico', 'auto_role_id'],
])('/config %s — bloquea roles peligrosos', (subcommand, column) => {
  it('un rol normal (sin permisos peligrosos) se guarda sin problema', async () => {
    const rol = makeRole('role-normal', PermissionFlagsBits.SendMessages | PermissionFlagsBits.ViewChannel);
    const interaction = makeInteraction({ subcommand, role: rol });

    await execute(interaction);

    expect(setGuildConfig).toHaveBeenCalledWith('guild-1', { [column]: 'role-normal' });
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('✅') }));
  });

  it('un rol con Administrator se rechaza, y NO se guarda nada', async () => {
    const rol = makeRole('role-admin', PermissionFlagsBits.Administrator);
    const interaction = makeInteraction({ subcommand, role: rol });

    await execute(interaction);

    expect(setGuildConfig).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Administrador') }),
    );
    // El mensaje explica POR QUÉ se rechazó, no solo "❌ error".
    const message = interaction.reply.mock.calls[0][0].content;
    expect(message).toMatch(/❌/);
    expect(message.length).toBeGreaterThan(20);
  });

  it('un rol con otro permiso peligroso (Gestionar roles) también se rechaza', async () => {
    const rol = makeRole('role-manage-roles', PermissionFlagsBits.ManageRoles);
    const interaction = makeInteraction({ subcommand, role: rol });

    await execute(interaction);

    expect(setGuildConfig).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Gestionar roles') }),
    );
  });

  it('un rol con BanMembers también se rechaza (no es solo Administrator lo que se revisa)', async () => {
    const rol = makeRole('role-ban', PermissionFlagsBits.BanMembers);
    const interaction = makeInteraction({ subcommand, role: rol });

    await execute(interaction);

    expect(setGuildConfig).not.toHaveBeenCalled();
  });

  it('desactivar el campo (sin rol) sigue funcionando — no hay rol que validar', async () => {
    const interaction = makeInteraction({ subcommand, role: null });

    await execute(interaction);

    expect(setGuildConfig).toHaveBeenCalledWith('guild-1', { [column]: null });
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('desactivado') }));
  });

  it('no envía ningún log de configuración cuando la validación rechaza el rol', async () => {
    const rol = makeRole('role-admin', PermissionFlagsBits.Administrator);
    const interaction = makeInteraction({ subcommand, role: rol });

    await execute(interaction);

    expect(logChannel.send).not.toHaveBeenCalled();
  });
});
