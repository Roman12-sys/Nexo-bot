import { vi, describe, it, expect } from 'vitest';

// permissions.js importa guildConfigStore.js, que a su vez importa supabaseClient.js
// (requiere variables de entorno reales). Se mockea para testear la lógica pura de
// jerarquía de getModerationBlockReason() sin necesitar credenciales de Supabase.
vi.mock('../src/supabaseClient.js', () => ({ supabase: {} }));

const { getModerationBlockReason } = await import('../src/utils/permissions.js');

function makeInteraction({ userId = 'mod-1', botId = 'bot-1', ownerId = 'owner-1', modPosition = 10 } = {}) {
  return {
    user: { id: userId },
    client: { user: { id: botId } },
    guild: { ownerId },
    member: { roles: { highest: { position: modPosition } } },
  };
}

function makeMember(id, position) {
  return { id, roles: { highest: { position } } };
}

describe('getModerationBlockReason', () => {
  it('sin target, no bloquea (null)', () => {
    expect(getModerationBlockReason(makeInteraction(), null)).toBeNull();
  });

  it('no podés aplicar una acción sobre vos mismo', () => {
    const interaction = makeInteraction({ userId: 'mod-1' });
    const target = makeMember('mod-1', 5);
    expect(getModerationBlockReason(interaction, target)).toMatch(/vos mismo/);
  });

  it('no podés aplicar una acción sobre el bot', () => {
    const interaction = makeInteraction({ botId: 'bot-1' });
    const target = makeMember('bot-1', 5);
    expect(getModerationBlockReason(interaction, target)).toMatch(/el bot/);
  });

  it('bloquea actuar sobre alguien de rango igual o superior', () => {
    const interaction = makeInteraction({ modPosition: 5 });
    const target = makeMember('other', 5); // mismo rango
    expect(getModerationBlockReason(interaction, target)).toMatch(/rango/);

    const higherTarget = makeMember('other', 8); // rango superior
    expect(getModerationBlockReason(interaction, higherTarget)).toMatch(/rango/);
  });

  it('permite actuar sobre alguien de rango inferior', () => {
    const interaction = makeInteraction({ modPosition: 10 });
    const target = makeMember('other', 3);
    expect(getModerationBlockReason(interaction, target)).toBeNull();
  });

  it('el dueño del servidor puede actuar sobre cualquiera, incluso rango igual/superior', () => {
    const interaction = makeInteraction({ userId: 'owner-1', ownerId: 'owner-1', modPosition: 1 });
    const target = makeMember('other', 99);
    expect(getModerationBlockReason(interaction, target)).toBeNull();
  });

  // Auditoría completa NEXO (2026-09-11), MOD-1: el dueño de un server no siempre tiene
  // un rol propio (Discord no lo exige) — su roles.highest.position puede ser 0, igual
  // que un miembro sin roles. Antes de este fix, la comparación de posiciones por sí
  // sola dejaba pasar a un moderador aplicando /punish sobre el dueño en ese caso.
  it('bloquea actuar sobre el dueño del servidor aunque no tenga ningún rol propio (position 0)', () => {
    const interaction = makeInteraction({ userId: 'mod-1', ownerId: 'owner-1', modPosition: 10 });
    const ownerAsTarget = makeMember('owner-1', 0);
    expect(getModerationBlockReason(interaction, ownerAsTarget)).toMatch(/dueño del servidor/);
  });
});

describe('getRoleConflictReason / getConfiguredRoleConflicts (2026-09-27)', () => {
  const CFG = { admin_role_id: 'admin', moderator_role_id: 'mod', punish_role_id: 'castigo', auto_role_id: 'auto' };

  it('rol automático: choca con cualquier rol de staff y con el de castigo', async () => {
    const { getRoleConflictReason } = await import('../src/utils/permissions.js');
    expect(getRoleConflictReason(CFG, 'admin', 'auto')).toMatch(/staff/);
    expect(getRoleConflictReason(CFG, 'mod', 'auto')).toMatch(/staff/);
    expect(getRoleConflictReason(CFG, 'castigo', 'auto')).toMatch(/castigo/);
    expect(getRoleConflictReason(CFG, 'otro', 'auto')).toBeNull();
    expect(getRoleConflictReason(CFG, 'auto', 'auto')).toBeNull();
  });

  it('rol de castigo: choca con staff y con el automático', async () => {
    const { getRoleConflictReason } = await import('../src/utils/permissions.js');
    expect(getRoleConflictReason(CFG, 'mod', 'punish')).toMatch(/staff/);
    expect(getRoleConflictReason(CFG, 'auto', 'punish')).toMatch(/automático/);
    expect(getRoleConflictReason(CFG, 'castigo', 'punish')).toBeNull();
  });

  it('rol de staff: choca con el automático y el de castigo, pero admin y moderador pueden ser el mismo', async () => {
    const { getRoleConflictReason } = await import('../src/utils/permissions.js');
    expect(getRoleConflictReason(CFG, 'auto', 'staff')).toMatch(/automático/);
    expect(getRoleConflictReason(CFG, 'castigo', 'staff')).toMatch(/castigo/);
    expect(getRoleConflictReason(CFG, 'mod', 'staff')).toBeNull();
    expect(getRoleConflictReason(CFG, 'admin', 'staff')).toBeNull();
  });

  it('sin config o sin rol: nunca hay conflicto (campos vacíos no chocan entre sí)', async () => {
    const { getRoleConflictReason } = await import('../src/utils/permissions.js');
    expect(getRoleConflictReason(null, 'x', 'auto')).toBeNull();
    expect(getRoleConflictReason(CFG, null, 'auto')).toBeNull();
    expect(getRoleConflictReason({ auto_role_id: null, punish_role_id: null }, 'x', 'staff')).toBeNull();
  });

  it('getConfiguredRoleConflicts: reporta el caso de Prueba bot (automático = staff) y nada en una config sana', async () => {
    const { getConfiguredRoleConflicts } = await import('../src/utils/permissions.js');
    expect(getConfiguredRoleConflicts(CFG)).toEqual([]);

    const pruebaBot = { admin_role_id: 'staff', moderator_role_id: 'staff', auto_role_id: 'staff', punish_role_id: 'sancionado' };
    const conflicts = getConfiguredRoleConflicts(pruebaBot);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ label: 'Rol automático', roleId: 'staff' });
  });

  it('getConfiguredRoleConflicts: automático = castigo se reporta una sola vez', async () => {
    const { getConfiguredRoleConflicts } = await import('../src/utils/permissions.js');
    const conflicts = getConfiguredRoleConflicts({ auto_role_id: 'x', punish_role_id: 'x' });
    expect(conflicts).toHaveLength(1);
  });
});
