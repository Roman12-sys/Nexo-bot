import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';

// /config rol-admin — PERM-1, Fase 4B: único subcomando de escritura que declara el rol
// OBLIGATORIO (sin "vacío para desactivar", ver el comentario en config.js) y que NO
// pasa por getDangerousRolePermission — mismo criterio que moderator_role_id en
// /setup: este rol está pensado para tener privilegios reales, a diferencia de
// rol-castigo/rol-automatico (que el bot asigna solo, sin revisión humana caso a caso).
const setGuildConfig = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig: vi.fn(), setGuildConfig }));

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

function makeInteraction(role) {
  return {
    guild: { ownerId: 'user-1' },
    member: { permissions: { has: () => true } },
    user: { id: 'user-1', tag: 'admin#0001' },
    guildId: 'guild-1',
    client: {},
    options: {
      getSubcommand: () => 'rol-admin',
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

describe('/config rol-admin', () => {
  it('guarda admin_role_id con el rol elegido y confirma', async () => {
    const rol = makeRole('role-admin-nuevo');
    const interaction = makeInteraction(rol);

    await execute(interaction);

    expect(setGuildConfig).toHaveBeenCalledWith('guild-1', { admin_role_id: 'role-admin-nuevo' });
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Rol de administrador configurado') }));
  });

  it('loguea el cambio en el canal de actividad', async () => {
    const rol = makeRole('role-admin-nuevo');
    const interaction = makeInteraction(rol);

    await execute(interaction);

    expect(logChannel.send).toHaveBeenCalledTimes(1);
  });

  it('a diferencia de rol-castigo/rol-automatico, SÍ acepta un rol con Administrator (no pasa por el chequeo de rol peligroso)', async () => {
    const rolPeligroso = makeRole('role-admin-real', PermissionFlagsBits.Administrator);
    const interaction = makeInteraction(rolPeligroso);

    await execute(interaction);

    expect(setGuildConfig).toHaveBeenCalledWith('guild-1', { admin_role_id: 'role-admin-real' });
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('✅') }));
  });
});
