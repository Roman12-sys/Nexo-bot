import { vi, describe, it, expect } from 'vitest';

// isStaff/isStaffConfigured son el gate que usan TODOS los comandos de moderación y
// buena parte de los de configuración — a diferencia de getModerationBlockReason (que
// compara jerarquía entre dos miembros, ya cubierto en permissions.test.js), esto
// resuelve "¿este usuario es staff en ESTE server?" contra guild_config. Se mockea
// guildConfigStore directamente (no supabase) porque es la única dependencia real de
// isStaff/isStaffConfigured — más simple y más rápido que mockear la capa de Supabase.
const getGuildConfig = vi.fn();
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig }));

const { isStaff, isStaffConfigured } = await import('../src/utils/permissions.js');

function makeInteraction(guildId, roleIds) {
  return {
    guildId,
    // Map real, no un objeto ad-hoc con solo .has(): isStaff() hace
    // [...interaction.member.roles.cache.keys()], igual que la Collection real de
    // discord.js (que extiende Map) — un mock sin .keys() revienta con
    // "roles.cache.keys is not a function" apenas se llama isStaff().
    member: { roles: { cache: new Map(roleIds.map((id) => [id, { id }])) } },
  };
}

describe('isStaff — matriz de roles', () => {
  it('usuario normal (sin rol de staff configurado en él) → false', async () => {
    getGuildConfig.mockResolvedValue({ admin_role_id: 'role-admin', moderator_role_id: 'role-mod' });
    const interaction = makeInteraction('guild-1', ['role-cualquiera']);

    await expect(isStaff(interaction)).resolves.toBe(false);
  });

  it('usuario con el rol de administrador configurado → true', async () => {
    getGuildConfig.mockResolvedValue({ admin_role_id: 'role-admin', moderator_role_id: 'role-mod' });
    const interaction = makeInteraction('guild-1', ['role-admin']);

    await expect(isStaff(interaction)).resolves.toBe(true);
  });

  it('usuario con el rol de moderador (no admin) configurado → true', async () => {
    getGuildConfig.mockResolvedValue({ admin_role_id: 'role-admin', moderator_role_id: 'role-mod' });
    const interaction = makeInteraction('guild-1', ['role-mod']);

    await expect(isStaff(interaction)).resolves.toBe(true);
  });

  it('guild_config sin ninguno de los dos roles configurado (null) → nunca es staff, sin importar los roles del usuario', async () => {
    getGuildConfig.mockResolvedValue({ admin_role_id: null, moderator_role_id: null });
    const interaction = makeInteraction('guild-1', ['role-admin', 'role-mod']);

    await expect(isStaff(interaction)).resolves.toBe(false);
  });
});

describe('isStaffConfigured — "¿corrieron /setup alguna vez?"', () => {
  it('sin admin_role_id ni moderator_role_id → false (todavía no se configuró staff)', async () => {
    getGuildConfig.mockResolvedValue({ admin_role_id: null, moderator_role_id: null });

    await expect(isStaffConfigured('guild-1')).resolves.toBe(false);
  });

  it('con al menos uno de los dos configurado → true', async () => {
    getGuildConfig.mockResolvedValue({ admin_role_id: null, moderator_role_id: 'role-mod' });

    await expect(isStaffConfigured('guild-1')).resolves.toBe(true);
  });
});
