import { vi, describe, it, expect, beforeEach } from 'vitest';

// /staff — Fase 1 del Staff Control Center (esqueleto de navegación, solo lectura).
// Lo que más importa proteger acá: (1) el gate de permisos real (isStaff), (2) que la
// sesión de navegación esté aislada por guild+usuario desde el día uno — mismo defecto
// que se encontró y corrigió en /setup y /anuncio (auditoría adversarial round 2,
// Bloque 1) — y (3) que cada pantalla muestre datos REALES de guild_config, nunca
// inventados.
const isStaff = vi.fn();
vi.mock('../src/utils/permissions.js', () => ({ isStaff }));

const getGuildConfig = vi.fn();
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig }));

const pingSupabase = vi.fn();
vi.mock('../src/supabaseClient.js', () => ({ pingSupabase }));

const getMissingBotPermissions = vi.fn();
vi.mock('../src/utils/botPermissions.js', () => ({ getMissingBotPermissions }));

const { execute } = await import('../src/commands/admin/staff.js');
const { routeButton } = await import('../src/components/buttons.js');

function makeInteraction({ guildId = 'guild-1', userId = 'staff-1', guildName = 'Comunidad de prueba' } = {}) {
  return {
    guild: { id: guildId, name: guildName },
    guildId,
    user: { id: userId, tag: `${userId}#0001` },
    client: {
      ws: { ping: 42 },
      uptime: 3_600_000,
      guilds: { cache: { size: 7 } },
    },
    reply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
  };
}

// Cada click arma una interaction NUEVA (igual que Discord manda una interaction
// distinta por cada botón apretado) — el estado de navegación en sí vive del lado del
// servidor (el Map `sessions` de staff.js), no en el objeto de interaction, así que no
// hace falta encadenar los clicks entre sí: alcanza con partir siempre de la
// interaction base de ESE guild+usuario y leer el payload de ESE click puntual.
async function nav(base, customId) {
  const clicked = { ...base, customId, update: vi.fn().mockResolvedValue(undefined) };
  await routeButton(clicked);
  return clicked;
}
function payloadOf(interactionLike) {
  if (interactionLike.update.mock.calls.length) return interactionLike.update.mock.calls.at(-1)[0];
  return interactionLike.reply.mock.calls.at(-1)[0];
}
function customIdsOf(payload) {
  return payload.components.flatMap((row) => row.components.map((c) => c.data.custom_id));
}
function fieldsOf(payload) {
  return payload.embeds[0].data.fields || [];
}
function fieldValue(payload, name) {
  return fieldsOf(payload).find((f) => f.name === name)?.value;
}

const FULL_CONFIG = {
  features: { moderacion: true, xp: true },
  moderator_role_id: 'role-mod',
  admin_role_id: 'role-admin',
  punish_role_id: 'role-punish',
  auto_role_id: 'role-auto',
  log_channel_moderation_id: 'chan-modlog',
  log_channel_activity_id: 'chan-activity',
  log_channel_economy_id: 'chan-ecolog',
  welcome_channel_id: 'chan-welcome',
  confession_channel_id: 'chan-confess',
  selfassignable_roles: ['role-gaming', 'role-anime'],
  level_roles: { 5: 'role-lvl5', 10: 'role-lvl10' },
  level_roles_mode: 'cumulative',
  xp_weekend_boost: true,
  weekly_digest_enabled: true,
  weekly_digest_last_sent_at: Date.now() - 86_400_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  isStaff.mockResolvedValue(true);
  getGuildConfig.mockResolvedValue({ ...FULL_CONFIG });
  pingSupabase.mockResolvedValue({ ok: true, ms: 55 });
  getMissingBotPermissions.mockReturnValue([]);
});

describe('/staff — gate de permisos', () => {
  it('rechaza a quien no es staff, sin abrir ningún panel', async () => {
    isStaff.mockResolvedValue(false);
    const interaction = makeInteraction();

    await execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('permisos') }));
    expect(interaction.reply.mock.calls[0][0].embeds).toBeUndefined();
  });
});

describe('/staff — home', () => {
  it('muestra los 12 módulos + fila de navegación, con datos reales del guild', async () => {
    const interaction = makeInteraction({ guildName: 'Comunidad Argenta' });

    await execute(interaction);

    const payload = payloadOf(interaction);
    expect(payload.embeds[0].data.title).toContain('NEXO STAFF');
    expect(fieldValue(payload, 'Servidor')).toBe('Comunidad Argenta');
    expect(fieldValue(payload, 'ID')).toBe('guild-1');
    expect(fieldValue(payload, 'Estado de NEXO')).toContain('42ms');

    const ids = customIdsOf(payload);
    const moduleIds = ids.filter((id) => id.startsWith('staff_nav_'));
    expect(moduleIds).toHaveLength(12);
    expect(moduleIds).toContain('staff_nav_moderacion');
    // El home NUNCA tiene botón "Volver" — no hay a dónde volver.
    expect(ids).not.toContain('staff_back');
    expect(ids).toContain('staff_close');
  });
});

describe('/staff — navegación y aislamiento de sesión', () => {
  it('Home → Configuración → Moderación → Volver → Volver termina de nuevo en Home', async () => {
    const interaction = makeInteraction();
    await execute(interaction);

    let clicked = await nav(interaction, 'staff_nav_config');
    let payload = payloadOf(clicked);
    expect(payload.embeds[0].data.title).toContain('Configuración');
    expect(customIdsOf(payload).filter((id) => id.startsWith('staff_nav_'))).toHaveLength(10);

    clicked = await nav(interaction, 'staff_nav_moderacion');
    payload = payloadOf(clicked);
    expect(payload.embeds[0].data.title).toContain('Moderación');

    clicked = await nav(interaction, 'staff_back');
    payload = payloadOf(clicked);
    expect(payload.embeds[0].data.title).toContain('Configuración');

    clicked = await nav(interaction, 'staff_back');
    payload = payloadOf(clicked);
    expect(payload.embeds[0].data.title).toContain('NEXO STAFF');
  });

  it('"Inicio" resetea el stack sin importar qué tan profundo se navegó', async () => {
    const interaction = makeInteraction();
    await execute(interaction);
    await nav(interaction, 'staff_nav_config');
    await nav(interaction, 'staff_nav_xp');

    let clicked = await nav(interaction, 'staff_home');
    expect(payloadOf(clicked).embeds[0].data.title).toContain('NEXO STAFF');

    // Confirma que el stack quedó REALMENTE reseteado (no solo mostró home una vez):
    // un solo "Volver" desde acá no debería tener a dónde ir más que quedarse en home.
    clicked = await nav(interaction, 'staff_back');
    expect(payloadOf(clicked).embeds[0].data.title).toContain('NEXO STAFF');
  });

  it('"Cerrar" limpia la sesión — un click después arranca un stack nuevo en vez de romper', async () => {
    const interaction = makeInteraction();
    await execute(interaction);
    await nav(interaction, 'staff_nav_config');

    const closed = await nav(interaction, 'staff_close');
    const closedPayload = payloadOf(closed);
    expect(closedPayload.content).toContain('cerrado');
    expect(closedPayload.embeds).toEqual([]);
    expect(closedPayload.components).toEqual([]);

    // Sesión ya borrada: un "Volver" tardío no debe tirar, cae a home con gracia.
    const afterClose = { ...interaction, customId: 'staff_back', update: vi.fn().mockResolvedValue(undefined) };
    await expect(routeButton(afterClose)).resolves.toBe(true);
    expect(payloadOf(afterClose).embeds[0].data.title).toContain('NEXO STAFF');
  });

  it('auditoría adversarial round 2, Bloque 1: el mismo usuario en DOS guilds nunca comparte sesión', async () => {
    const userId = 'staff-1';
    const interactionA = makeInteraction({ guildId: 'guild-A', userId });
    const interactionB = makeInteraction({ guildId: 'guild-B', userId });

    await execute(interactionA);
    await nav(interactionA, 'staff_nav_config');
    await nav(interactionA, 'staff_nav_moderacion');

    await execute(interactionB);
    await nav(interactionB, 'staff_nav_economia');

    // "Volver" en A tiene que respetar el stack DE A (moderación -> config), nunca
    // verse afectado por la navegación de B.
    const backA = await nav(interactionA, 'staff_back');
    expect(payloadOf(backA).embeds[0].data.title).toContain('Configuración');

    // Y "Volver" en B tiene que respetar el stack DE B (economía -> home), no el de A.
    const backB = await nav(interactionB, 'staff_back');
    expect(payloadOf(backB).embeds[0].data.title).toContain('NEXO STAFF');
  });
});

describe('/staff — contenido real por módulo (sin inventar datos)', () => {
  it('Moderación muestra roles y canal reales de guild_config', async () => {
    const interaction = makeInteraction();
    await execute(interaction);
    const clicked = await nav(interaction, 'staff_nav_moderacion');

    const payload = payloadOf(clicked);
    expect(fieldValue(payload, 'Módulo')).toContain('Activado');
    expect(fieldValue(payload, 'Rol de moderador')).toBe('<@&role-mod>');
    expect(fieldValue(payload, 'Canal de logs')).toBe('<#chan-modlog>');
  });

  it('Moderación muestra "sin configurar" cuando el guild no tiene nada seteado (nunca inventa un valor)', async () => {
    getGuildConfig.mockResolvedValue({ features: {} });
    const interaction = makeInteraction();
    await execute(interaction);
    const clicked = await nav(interaction, 'staff_nav_moderacion');

    const payload = payloadOf(clicked);
    expect(fieldValue(payload, 'Módulo')).toContain('Desactivado');
    expect(fieldValue(payload, 'Rol de moderador')).toContain('Sin configurar');
  });

  it('Roles muestra la cantidad real de autoasignables y por nivel', async () => {
    const interaction = makeInteraction();
    await execute(interaction);
    const clicked = await nav(interaction, 'staff_nav_roles');

    const payload = payloadOf(clicked);
    expect(fieldsOf(payload).find((f) => f.name.startsWith('Autoasignables'))?.name).toBe('Autoasignables (2)');
    expect(fieldValue(payload, 'Por nivel')).toBe('2 configurado(s)');
  });

  it('Canales lista los 5 canales reales configurados', async () => {
    const interaction = makeInteraction();
    await execute(interaction);
    await nav(interaction, 'staff_nav_config');
    const clicked = await nav(interaction, 'staff_nav_canales');

    const payload = payloadOf(clicked);
    expect(fieldValue(payload, 'Logs de actividad')).toBe('<#chan-activity>');
    expect(fieldValue(payload, 'Bienvenida')).toBe('<#chan-welcome>');
  });

  it('Economía muestra la nota de "siempre activa" sin depender de ningún feature flag', async () => {
    const interaction = makeInteraction();
    await execute(interaction);
    const clicked = await nav(interaction, 'staff_nav_economia');

    const payload = payloadOf(clicked);
    expect(payload.embeds[0].data.description).toContain('siempre activo');
  });

  it('los módulos sin datos conectados todavía (Sorteos, Anuncios, etc.) muestran el placeholder honesto, sin ni siquiera pedir guild_config', async () => {
    const interaction = makeInteraction();
    await execute(interaction);
    const clicked = await nav(interaction, 'staff_nav_sorteos');

    const payload = payloadOf(clicked);
    expect(payload.embeds[0].data.description).toContain('🚧');
    expect(getGuildConfig).not.toHaveBeenCalled();
  });
});

describe('/staff — Sistema (datos reales, mismo criterio que /estado)', () => {
  it('muestra latencia, Supabase, servidores y permisos reales', async () => {
    const interaction = makeInteraction();
    await execute(interaction);
    const clicked = await nav(interaction, 'staff_nav_sistema');

    const payload = payloadOf(clicked);
    expect(fieldValue(payload, '📡 Latencia (gateway)')).toBe('42ms');
    expect(fieldValue(payload, '🗄️ Supabase')).toContain('OK (55ms)');
    expect(fieldValue(payload, '🌐 Servidores totales')).toBe('7');
    expect(fieldValue(payload, '🔐 Permisos del bot')).toContain('Todo OK');
  });

  it('avisa permisos faltantes cuando getMissingBotPermissions devuelve algo', async () => {
    getMissingBotPermissions.mockReturnValue([{ label: 'Gestionar roles' }]);
    const interaction = makeInteraction();
    await execute(interaction);
    const clicked = await nav(interaction, 'staff_nav_sistema');

    const payload = payloadOf(clicked);
    expect(fieldValue(payload, '🔐 Permisos del bot')).toContain('Gestionar roles');
  });
});
