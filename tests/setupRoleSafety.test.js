import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';

// FASE 1.1 (cierre de la Fase 1, 2026-08-30) — /config ya bloqueaba roles peligrosos
// (rol-castigo/rol-automatico) pero /setup podía terminar fijando los MISMOS dos campos
// (auto_role_id/punish_role_id) reusando un rol existente por coincidencia exacta de
// nombre ("Miembro"/"Sancionado") sin ninguna validación — si ese rol ya tenía un
// permiso peligroso (por la razón que sea: alguien lo creó así, o se lo dieron después),
// /setup se lo entregaba en silencio a cada miembro nuevo, o se lo agregaba a cualquier
// usuario sancionado. Este archivo prueba que resolveRole (con rejectDangerous: true,
// ver setup.js) usa la MISMA política central que /config
// (getDangerousRolePermission de src/utils/permissions.js — no una copia) y que el
// resultado final persistido en guild_config nunca apunta a un rol peligroso.
//
// El flujo se ejercita de punta a punta a través del router REAL de botones
// (routeButton), igual criterio que moderation.test.js para los paneles de
// confirmación — no se llama una función interna a mano.
const getGuildConfig = vi.fn();
const setGuildConfig = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig, setGuildConfig }));

const getGuildLogChannel = vi.fn().mockResolvedValue(null); // sin canal de logs — no hace falta para este archivo
vi.mock('../src/utils/guildLogChannels.js', () => ({ getGuildLogChannel }));

await import('../src/commands/admin/setup.js'); // side effect: registra los handlers de botón/select
const { routeButton } = await import('../src/components/buttons.js');

function makeRole(id, name, { permissionBits = 0n } = {}) {
  return {
    id,
    name,
    toString: () => `<@&${id}>`,
    permissions: { has: (flag) => (permissionBits & flag) === flag },
  };
}

// Registro de roles en memoria para el guild falso: cubre roles.cache.find (búsqueda
// por nombre), roles.fetch (por ID guardado) y roles.create (nuevo rol) — las 3
// operaciones que resolveRole necesita, con el mismo comportamiento relevante que la
// API real de discord.js.
function makeGuildRoleRegistry(initialRoles = []) {
  const byId = new Map(initialRoles.map((r) => [r.id, r]));
  let counter = 1;

  return {
    cache: { find: (predicate) => [...byId.values()].find(predicate) },
    fetch: vi.fn(async (id) => byId.get(id) || null),
    create: vi.fn(async ({ name, color, hoist }) => {
      const role = makeRole(`role-nuevo-${counter++}`, name, { permissionBits: 0n });
      byId.set(role.id, role);
      return role;
    }),
    everyone: { id: 'role-everyone' },
  };
}

function makeInteraction({ userId = 'admin-1', guildId = 'guild-1', roles = [] } = {}) {
  return {
    guild: { id: guildId, ownerId: userId, roles: makeGuildRoleRegistry(roles) },
    guildId,
    user: { id: userId, tag: 'admin#0001' },
    member: { permissions: { has: () => true } },
    client: {},
    reply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

function makeFollowUp(base, customId) {
  // Reusa guild/user/client/guildId de la interaction original — mismo criterio que
  // makeButtonInteraction en discordMock.js: los botones del panel de /setup necesitan
  // el MISMO guild falso (con su registro de roles) para que runSetup opere sobre el
  // estado real de la sesión, no una copia nueva.
  return { ...base, customId, update: vi.fn().mockResolvedValue(undefined), reply: vi.fn().mockResolvedValue(undefined) };
}

// Corre /setup completo: plantilla personalizada (sin moderación/xp/bienvenida/
// confesiones — así nunca hace falta mockear canales, solo roles) → prende SOLO los
// extras pedidos → confirma. Devuelve la interaction final del botón "confirmar" para
// poder inspeccionar reply/editReply si hiciera falta.
async function runSetupFlow(interaction, { extras = [] } = {}) {
  const templateInteraction = makeFollowUp(interaction, 'setup_template_personalizado');
  await routeButton(templateInteraction);

  for (const stateKey of extras) {
    const toggleInteraction = makeFollowUp(interaction, `setup_toggle_${stateKey}`);
    await routeButton(toggleInteraction);
  }

  const confirmInteraction = makeFollowUp(interaction, 'setup_confirm');
  await routeButton(confirmInteraction);
  return confirmInteraction;
}

beforeEach(() => {
  vi.clearAllMocks();
  getGuildLogChannel.mockResolvedValue(null);
});

describe('/setup — protección de auto_role_id contra roles peligrosos', () => {
  it('Caso 1: no existe "Miembro" todavía — crea uno nuevo, como antes', async () => {
    getGuildConfig.mockResolvedValue({ auto_role_id: null });
    const interaction = makeInteraction({ roles: [] });

    await runSetupFlow(interaction, { extras: ['autoRol'] });

    const call = setGuildConfig.mock.calls.find((c) => 'auto_role_id' in c[1]);
    expect(call).toBeDefined();
    expect(call[1].auto_role_id).toMatch(/^role-nuevo-/);
  });

  it('Caso 2: existe "Miembro" normal — lo reusa', async () => {
    const normalRole = makeRole('role-miembro-normal', 'Miembro', { permissionBits: PermissionFlagsBits.SendMessages });
    getGuildConfig.mockResolvedValue({ auto_role_id: null });
    const interaction = makeInteraction({ roles: [normalRole] });

    await runSetupFlow(interaction, { extras: ['autoRol'] });

    expect(setGuildConfig).toHaveBeenCalledWith('guild-1', { auto_role_id: 'role-miembro-normal' });
  });

  it('Caso 3: existe "Miembro" con Administrator — NO lo asigna, crea uno seguro en su lugar', async () => {
    const dangerousRole = makeRole('role-miembro-admin', 'Miembro', { permissionBits: PermissionFlagsBits.Administrator });
    getGuildConfig.mockResolvedValue({ auto_role_id: null });
    const interaction = makeInteraction({ roles: [dangerousRole] });

    await runSetupFlow(interaction, { extras: ['autoRol'] });

    // Nunca se persiste el rol peligroso.
    expect(setGuildConfig).not.toHaveBeenCalledWith('guild-1', { auto_role_id: 'role-miembro-admin' });
    // Se persiste un rol distinto, recién creado (seguro por construcción: create() en
    // el mock siempre da permissionBits: 0n).
    const call = setGuildConfig.mock.calls.find((c) => 'auto_role_id' in c[1]);
    expect(call[1].auto_role_id).not.toBe('role-miembro-admin');
    expect(call[1].auto_role_id).toMatch(/^role-nuevo-/);
    // El admin queda informado — no es un skip silencioso.
    const finalEmbed = interaction.editReply.mock.calls.at(-1)?.[0]?.embeds?.[0];
    expect(finalEmbed?.data?.description).toMatch(/permiso.*Administrador/is);
  });

  it('rol ya guardado por ID (no por nombre) que ahora tiene un permiso peligroso tampoco se reusa', async () => {
    const dangerousRole = makeRole('role-guardado-viejo', 'Miembro', { permissionBits: PermissionFlagsBits.ManageRoles });
    getGuildConfig.mockResolvedValue({ auto_role_id: 'role-guardado-viejo' });
    const interaction = makeInteraction({ roles: [dangerousRole] });

    await runSetupFlow(interaction, { extras: ['autoRol'] });

    expect(setGuildConfig).not.toHaveBeenCalledWith('guild-1', { auto_role_id: 'role-guardado-viejo' });
  });
});

describe('/setup — protección de punish_role_id contra roles peligrosos', () => {
  it('Caso 4: existe "Sancionado" normal — lo reusa', async () => {
    const normalRole = makeRole('role-sancionado-normal', 'Sancionado', { permissionBits: 0n });
    getGuildConfig.mockResolvedValue({ punish_role_id: null });
    const interaction = makeInteraction({ roles: [normalRole] });

    await runSetupFlow(interaction, { extras: ['castigo'] });

    expect(setGuildConfig).toHaveBeenCalledWith('guild-1', { punish_role_id: 'role-sancionado-normal' });
  });

  it('Caso 5: existe "Sancionado" con BanMembers — NO queda configurado como punish_role_id', async () => {
    const dangerousRole = makeRole('role-sancionado-ban', 'Sancionado', { permissionBits: PermissionFlagsBits.BanMembers });
    getGuildConfig.mockResolvedValue({ punish_role_id: null });
    const interaction = makeInteraction({ roles: [dangerousRole] });

    await runSetupFlow(interaction, { extras: ['castigo'] });

    expect(setGuildConfig).not.toHaveBeenCalledWith('guild-1', { punish_role_id: 'role-sancionado-ban' });
    const call = setGuildConfig.mock.calls.find((c) => 'punish_role_id' in c[1]);
    expect(call[1].punish_role_id).not.toBe('role-sancionado-ban');
    expect(call[1].punish_role_id).toMatch(/^role-nuevo-/);
  });
});

describe('/setup — configuración final coherente (sin estados parciales)', () => {
  it('con autoRol y castigo peligrosos a la vez: los dos terminan apuntando a roles seguros, y setup_completed_at se guarda igual', async () => {
    const dangerousAuto = makeRole('role-miembro-admin', 'Miembro', { permissionBits: PermissionFlagsBits.Administrator });
    const dangerousPunish = makeRole('role-sancionado-ban', 'Sancionado', { permissionBits: PermissionFlagsBits.BanMembers });
    getGuildConfig.mockResolvedValue({ auto_role_id: null, punish_role_id: null });
    const interaction = makeInteraction({ roles: [dangerousAuto, dangerousPunish] });

    await runSetupFlow(interaction, { extras: ['autoRol', 'castigo'] });

    expect(setGuildConfig).not.toHaveBeenCalledWith('guild-1', { auto_role_id: 'role-miembro-admin' });
    expect(setGuildConfig).not.toHaveBeenCalledWith('guild-1', { punish_role_id: 'role-sancionado-ban' });
    // El flujo completa igual (no queda a mitad de camino): setup_completed_at se llega
    // a guardar, señal de que runSetup terminó sin tirar.
    expect(setGuildConfig.mock.calls.some((c) => 'setup_completed_at' in c[1])).toBe(true);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: [expect.objectContaining({ data: expect.objectContaining({ title: expect.stringContaining('configurado') }) })] }),
    );
  });

  it('rol de staff (moderator_role_id) NO pasa por esta política — puede tener permisos amplios a propósito', async () => {
    // Staff SIN extras: solo el rol "Staff" se resuelve. Nada de auto_role_id/
    // punish_role_id en juego acá — confirma que resolveRole del staff sigue sin
    // rejectDangerous (no se le aplicó la política por accidente).
    getGuildConfig.mockResolvedValue({});
    const interaction = makeInteraction({ roles: [] });

    await runSetupFlow(interaction, { extras: [] });

    const staffCall = setGuildConfig.mock.calls.find((c) => 'moderator_role_id' in c[1]);
    expect(staffCall).toBeDefined();
    expect(staffCall[1].moderator_role_id).toMatch(/^role-nuevo-/);
  });
});
