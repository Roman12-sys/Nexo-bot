import { vi, describe, it, expect } from 'vitest';

// isStaff/isStaffConfigured son el gate que usan TODOS los comandos de moderación y
// buena parte de los de configuración — a diferencia de getModerationBlockReason (que
// compara jerarquía entre dos miembros, ya cubierto en permissions.test.js), esto
// resuelve "¿este usuario es staff en ESTE server?" contra guild_config. Se mockea
// guildConfigStore directamente (no supabase) porque es la única dependencia real de
// isStaff/isStaffConfigured — más simple y más rápido que mockear la capa de Supabase.
const getGuildConfig = vi.fn();
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig }));

const { isStaff, isStaffConfigured, isAdmin } = await import('../src/utils/permissions.js');

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

// isAdmin — PERM-1, Fase 4B: a diferencia de isStaff() (OR puro entre los dos roles),
// esto exige EXCLUSIVAMENTE admin_role_id. La fila que realmente prueba la separación
// de tiers es "moderador puro (no admin) → false" — antes de este fix, isStaff() daba
// true para ese mismo rol, así que un moderador podía usar /economia-staff/xp igual
// que un admin.
describe('isAdmin — tier separado de isStaff (PERM-1)', () => {
  it('usuario con SOLO el rol de moderador (admin_role_id distinto) → false', async () => {
    getGuildConfig.mockResolvedValue({ admin_role_id: 'role-admin', moderator_role_id: 'role-mod' });
    const interaction = makeInteraction('guild-1', ['role-mod']);

    await expect(isAdmin(interaction)).resolves.toBe(false);
  });

  it('usuario con el rol de administrador → true', async () => {
    getGuildConfig.mockResolvedValue({ admin_role_id: 'role-admin', moderator_role_id: 'role-mod' });
    const interaction = makeInteraction('guild-1', ['role-admin']);

    await expect(isAdmin(interaction)).resolves.toBe(true);
  });

  it('usuario con AMBOS roles (admin y mod) → true', async () => {
    getGuildConfig.mockResolvedValue({ admin_role_id: 'role-admin', moderator_role_id: 'role-mod' });
    const interaction = makeInteraction('guild-1', ['role-admin', 'role-mod']);

    await expect(isAdmin(interaction)).resolves.toBe(true);
  });

  it('admin_role_id sin configurar (null) → siempre false, sin importar los roles del usuario', async () => {
    getGuildConfig.mockResolvedValue({ admin_role_id: null, moderator_role_id: 'role-mod' });
    const interaction = makeInteraction('guild-1', ['role-mod', 'role-admin']);

    await expect(isAdmin(interaction)).resolves.toBe(false);
  });

  it('backward compatibility — configuración antigua (admin_role_id === moderator_role_id, mismo rol de /setup): ese rol pasa isAdmin también', async () => {
    getGuildConfig.mockResolvedValue({ admin_role_id: 'role-staff-unico', moderator_role_id: 'role-staff-unico' });
    const interaction = makeInteraction('guild-1', ['role-staff-unico']);

    await expect(isStaff(interaction)).resolves.toBe(true);
    await expect(isAdmin(interaction)).resolves.toBe(true);
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
