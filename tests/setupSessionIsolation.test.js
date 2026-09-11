import { vi, describe, it, expect, beforeEach } from 'vitest';

// Auditoría adversarial round 2, Bloque 1 — la sesión en memoria de /setup estaba
// indexada SOLO por userId (`sessions.get(interaction.user.id)`), sin guildId. Un
// mismo admin (escenario esperado: Nexo es multi-tenant) que arranca /setup en el
// Guild A y, ANTES de confirmar, arranca /setup en el Guild B, pisaba silenciosamente
// la sesión de A — el botón "Confirmar" del panel de A terminaba corriendo con los
// datos de B. El fix compone la key como `${guildId}:${userId}`; estos tests
// reproducen exactamente el escenario cruzado y confirman que cada guild usa
// EXCLUSIVAMENTE su propia sesión, ejercitando el flujo real a través del router de
// botones (mismo criterio que setupRoleSafety.test.js).
const getGuildConfig = vi.fn().mockResolvedValue({});
const setGuildConfig = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig, setGuildConfig }));

const getGuildLogChannel = vi.fn().mockResolvedValue(null);
vi.mock('../src/utils/guildLogChannels.js', () => ({ getGuildLogChannel }));

await import('../src/commands/admin/setup.js');
const { routeButton } = await import('../src/components/buttons.js');

function makeRole(id, name) {
  return { id, name, toString: () => `<@&${id}>`, permissions: { has: () => false } };
}

function makeGuildRoleRegistry() {
  const byId = new Map();
  let counter = 1;
  return {
    cache: { find: (predicate) => [...byId.values()].find(predicate) },
    fetch: vi.fn(async (id) => byId.get(id) || null),
    create: vi.fn(async ({ name }) => {
      const role = makeRole(`role-${counter++}`, name);
      byId.set(role.id, role);
      return role;
    }),
    everyone: { id: 'role-everyone' },
  };
}

function makeInteraction({ userId, guildId }) {
  return {
    guild: { id: guildId, ownerId: userId, roles: makeGuildRoleRegistry() },
    guildId,
    user: { id: userId, tag: `${userId}#0001` },
    member: { permissions: { has: () => true } },
    client: {},
    reply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

// Cada "click" en el panel real de Discord es una interacción NUEVA que comparte
// guild/user/client/editReply con el mensaje original — mismo criterio que
// makeFollowUp en setupRoleSafety.test.js (editReply no se reemplaza a propósito:
// runSetup y el resto del flujo siguen escribiendo sobre el mismo mock).
function click(base, customId) {
  return { ...base, customId, update: vi.fn().mockResolvedValue(undefined), reply: vi.fn().mockResolvedValue(undefined) };
}

function setGuildConfigCallsFor(guildId) {
  return setGuildConfig.mock.calls.filter((c) => c[0] === guildId);
}

beforeEach(() => {
  vi.clearAllMocks();
  getGuildConfig.mockResolvedValue({});
  getGuildLogChannel.mockResolvedValue(null);
});

describe('/setup — aislamiento de sesión cross-guild', () => {
  it('escenario del bug: mismo admin, guild A abre setup y togglea autoRol; guild B abre setup y togglea castigo; confirmar A usa SOLO los datos de A', async () => {
    const userId = 'admin-1';
    const interactionA = makeInteraction({ userId, guildId: 'guild-A' });
    const interactionB = makeInteraction({ userId, guildId: 'guild-B' });

    // 1) admin abre /setup en A
    await routeButton(click(interactionA, 'setup_template_personalizado'));
    // 2) togglea "rol automático" en A
    await routeButton(click(interactionA, 'setup_toggle_autoRol'));

    // 3) SIN confirmar A, el mismo admin abre /setup en B
    await routeButton(click(interactionB, 'setup_template_personalizado'));
    // 4) togglea "rol de castigo" en B (una feature DISTINTA a la de A)
    await routeButton(click(interactionB, 'setup_toggle_castigo'));

    // 5) confirma A
    const confirmA = click(interactionA, 'setup_confirm');
    await routeButton(confirmA);

    const callsA = setGuildConfigCallsFor('guild-A');
    // A tiene que haber resuelto auto_role_id (lo que SÍ toggleó en su propio panel).
    expect(callsA.some((c) => 'auto_role_id' in c[1] && c[1].auto_role_id)).toBe(true);
    // A NUNCA debería haber tocado punish_role_id — esa feature se toggleó en el panel
    // de B, no en el de A. Si el bug de sesión cross-guild siguiera presente, acá
    // aparecería seteado (la sesión de A habría sido pisada por la de B).
    expect(callsA.some((c) => 'punish_role_id' in c[1] && c[1].punish_role_id)).toBe(false);

    // 6) confirma B — debe usar SU PROPIA sesión, no la que ya se consumió de A.
    const confirmB = click(interactionB, 'setup_confirm');
    await routeButton(confirmB);

    const callsB = setGuildConfigCallsFor('guild-B');
    expect(callsB.some((c) => 'punish_role_id' in c[1] && c[1].punish_role_id)).toBe(true);
    expect(callsB.some((c) => 'auto_role_id' in c[1] && c[1].auto_role_id)).toBe(false);
  });

  it('dos sesiones seguidas del MISMO usuario en el MISMO guild: la segunda reemplaza a la primera (comportamiento esperado, no un bug)', async () => {
    const interaction = makeInteraction({ userId: 'admin-1', guildId: 'guild-A' });

    await routeButton(click(interaction, 'setup_template_personalizado'));
    await routeButton(click(interaction, 'setup_toggle_autoRol'));
    // Vuelve a arrancar /setup en el MISMO guild (ej. se arrepintió y reinició el flujo).
    await routeButton(click(interaction, 'setup_template_personalizado'));

    const confirm = click(interaction, 'setup_confirm');
    await routeButton(confirm);

    // El segundo arranque reseteó los extras (autoRol vuelve a false) — no queda un
    // extra "fantasma" del primer intento.
    const calls = setGuildConfigCallsFor('guild-A');
    expect(calls.some((c) => 'auto_role_id' in c[1] && c[1].auto_role_id)).toBe(false);
  });

  it('dos usuarios distintos en el mismo guild no interfieren entre sí', async () => {
    const guildId = 'guild-shared';
    const interactionU1 = makeInteraction({ userId: 'user-1', guildId });
    const interactionU2 = makeInteraction({ userId: 'user-2', guildId });

    await routeButton(click(interactionU1, 'setup_template_personalizado'));
    await routeButton(click(interactionU1, 'setup_toggle_autoRol'));

    await routeButton(click(interactionU2, 'setup_template_personalizado'));
    await routeButton(click(interactionU2, 'setup_toggle_castigo'));

    await routeButton(click(interactionU1, 'setup_confirm'));

    const calls = setGuildConfigCallsFor(guildId);
    expect(calls.some((c) => 'auto_role_id' in c[1] && c[1].auto_role_id)).toBe(true);
    expect(calls.some((c) => 'punish_role_id' in c[1] && c[1].punish_role_id)).toBe(false);
  });

  it('cancelar la sesión y confirmar después responde "sesión expiró", nunca corre runSetup', async () => {
    const interaction = makeInteraction({ userId: 'admin-1', guildId: 'guild-A' });

    await routeButton(click(interaction, 'setup_template_personalizado'));
    await routeButton(click(interaction, 'setup_cancel'));

    const confirm = click(interaction, 'setup_confirm');
    await routeButton(confirm);

    expect(confirm.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('expiró') }));
    expect(setGuildConfig).not.toHaveBeenCalled();
  });

  it('confirmar sin haber iniciado nunca /setup en ese guild responde "sesión expiró"', async () => {
    const interaction = makeInteraction({ userId: 'admin-nuevo', guildId: 'guild-nunca-abierto' });

    const confirm = click(interaction, 'setup_confirm');
    await routeButton(confirm);

    expect(confirm.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('expiró') }));
    expect(setGuildConfig).not.toHaveBeenCalled();
  });
});
