import { vi, describe, it, expect, beforeEach } from 'vitest';

// /staff — Fase 1 del Staff Control Center (esqueleto de navegación, solo lectura).
// Lo que más importa proteger acá: (1) el gate de permisos real (isStaff), (2) que la
// sesión de navegación esté aislada por guild+usuario desde el día uno — mismo defecto
// que se encontró y corrigió en /setup y /anuncio (auditoría adversarial round 2,
// Bloque 1) — y (3) que cada pantalla muestre datos REALES de guild_config, nunca
// inventados.
const isStaff = vi.fn();
const getDangerousRolePermission = vi.fn(() => null);
vi.mock('../src/utils/permissions.js', () => ({ isStaff, getDangerousRolePermission }));

const getGuildConfig = vi.fn();
const setGuildConfig = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig, setGuildConfig }));

const pingSupabase = vi.fn();
vi.mock('../src/supabaseClient.js', () => ({ pingSupabase }));

const getMissingBotPermissions = vi.fn();
vi.mock('../src/utils/botPermissions.js', () => ({ getMissingBotPermissions }));

// Fase 3 (Economía) — economyStore.js real pega a Supabase; se mockea completo acá
// porque staff.js solo necesita estas 2 lecturas (circulante + top balances), mismo
// criterio que el resto de los mocks de este archivo: probar que /staff LAS LLAMA y
// MUESTRA lo que devuelven, no la implementación de la RPC en sí (ya cubierta en
// economyStore.test.js).
const getGuildCirculatingBalance = vi.fn();
const getTopBalances = vi.fn();
vi.mock('../src/utils/economyStore.js', () => ({ getGuildCirculatingBalance, getTopBalances }));

// Fase 4 (Roles autoasignables) — mismo criterio: resolveLiveSelfRoles() ya tiene su
// propia batería de tests en selfRoles.test.js (roles borrados/peligrosos/por encima
// del bot); acá solo importa que /staff LA LLAME y construya el select con lo que
// devuelve, no reimplementar esa revalidación.
const resolveLiveSelfRoles = vi.fn();
vi.mock('../src/utils/selfRoles.js', () => ({ resolveLiveSelfRoles }));

// Fase 5 (Sorteos/Anuncios) — mismo criterio: getGuildGiveawaysForAutocomplete ya
// tiene sus propios tests en giveawaysStore/giveawayEngine; acá solo importa que
// /staff la llame y muestre lo que devuelve. startAnuncioBuilder se mockea para
// probar que /staff LA INVOCA (con la interacción real) sin reimplementar el
// builder — anuncio.js ya tiene su propia batería completa.
const getGuildGiveawaysForAutocomplete = vi.fn();
vi.mock('../src/utils/giveawaysStore.js', () => ({ getGuildGiveawaysForAutocomplete }));

const getGuildAnnouncementTemplates = vi.fn();
vi.mock('../src/utils/announcementTemplatesStore.js', () => ({ getGuildAnnouncementTemplates }));

const startAnuncioBuilder = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/commands/anuncios/anuncio.js', () => ({ startBuilder: startAnuncioBuilder }));

// logConfigChange (Fase 2) — auditoría de escrituras hecha desde /staff, exportada de
// config.js para reusar el mismo formato. Se mockea acá para no depender de
// getGuildLogChannel/createBotConfigLogEmbed reales — lo que importa probar es que
// /staff LA LLAMA con el texto correcto, no su implementación interna (ya cubierta
// donde corresponde, en los tests de /config).
const logConfigChange = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/commands/admin/config.js', () => ({ logConfigChange }));

const { execute } = await import('../src/commands/admin/staff.js');
const { routeButton } = await import('../src/components/buttons.js');
const { routeSelect } = await import('../src/components/selects.js');

function makeInteraction({
  guildId = 'guild-1',
  userId = 'staff-1',
  guildName = 'Comunidad de prueba',
  ownerId = 'owner-1',
  isAdministrator = false,
  botCanManageRoles = true,
  botRolePosition = 100,
} = {}) {
  return {
    guild: {
      id: guildId,
      name: guildName,
      ownerId,
      members: {
        me: {
          permissions: { has: vi.fn(() => botCanManageRoles) },
          roles: { highest: { position: botRolePosition } },
        },
      },
    },
    guildId,
    user: { id: userId, tag: `${userId}#0001` },
    member: { permissions: { has: vi.fn(() => isAdministrator) } },
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
  const clicked = { ...base, customId, update: vi.fn().mockResolvedValue(undefined), followUp: vi.fn().mockResolvedValue(undefined) };
  await routeButton(clicked);
  return clicked;
}
// Selects (Fase 2) — `values` es lo elegido; `roles` simula el Collection que
// discord.js resuelve para un RoleSelectMenu (con .first()), igual criterio que
// anuncio.js ya usa para su select de mención.
async function navSelect(base, customId, { values = [], role = null } = {}) {
  const clicked = {
    ...base,
    customId,
    values,
    roles: { first: () => role },
    update: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
  };
  await routeSelect(clicked);
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
  getDangerousRolePermission.mockReturnValue(null);
  setGuildConfig.mockResolvedValue(undefined);
  logConfigChange.mockResolvedValue(undefined);
  getGuildCirculatingBalance.mockResolvedValue(48_200);
  getTopBalances.mockResolvedValue([
    { userId: 'user-rico', balance: 10_000 },
    { userId: 'user-medio', balance: 4_500 },
  ]);
  resolveLiveSelfRoles.mockResolvedValue([
    { id: 'role-gaming', name: 'Gaming' },
    { id: 'role-anime', name: 'Anime' },
  ]);
  getGuildGiveawaysForAutocomplete.mockImplementation(async (guildId, ended) =>
    ended ? [{ messageId: 'msg-old', prize: 'Rol VIP' }] : [{ messageId: 'msg-1', prize: 'Nitro Classic' }],
  );
  getGuildAnnouncementTemplates.mockResolvedValue([{ name: 'Mantenimiento', data: {}, createdAt: '2026-01-01' }]);
  startAnuncioBuilder.mockResolvedValue(undefined);
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

  it('Economía muestra la nota de "siempre activa" sin depender de ningún feature flag, y el circulante real', async () => {
    const interaction = makeInteraction();
    await execute(interaction);
    const clicked = await nav(interaction, 'staff_nav_economia');

    const payload = payloadOf(clicked);
    expect(payload.embeds[0].data.description).toContain('siempre activo');
    expect(fieldValue(payload, 'Coins en circulación')).toBe('48.200');
    expect(getGuildConfig).not.toHaveBeenCalled(); // economía no depende de guild_config
  });

  it('los módulos sin datos conectados todavía (Estadísticas, Misiones, etc.) muestran el placeholder honesto, sin ni siquiera pedir guild_config', async () => {
    const interaction = makeInteraction();
    await execute(interaction);
    const clicked = await nav(interaction, 'staff_nav_estadisticas');

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

describe('/staff — Fase 2: editar Moderación (primera escritura real)', () => {
  it('los botones de editar están DESHABILITADOS para un staff que no es dueño ni Administrator', async () => {
    const interaction = makeInteraction({ isAdministrator: false });
    await execute(interaction);
    const clicked = await nav(interaction, 'staff_nav_moderacion');

    const payload = payloadOf(clicked);
    const editRow = payload.components[0];
    expect(editRow.components.every((b) => b.data.disabled)).toBe(true);
    expect(payload.embeds[0].data.footer.text).toContain('🔒');
  });

  it('los botones de editar están habilitados para un Administrator', async () => {
    const interaction = makeInteraction({ isAdministrator: true });
    await execute(interaction);
    const clicked = await nav(interaction, 'staff_nav_moderacion');

    const editRow = payloadOf(clicked).components[0];
    expect(editRow.components.every((b) => b.data.disabled)).toBe(false);
  });

  it('los botones de editar están habilitados para el DUEÑO del servidor aunque no tenga Administrator', async () => {
    const interaction = makeInteraction({ userId: 'owner-1', ownerId: 'owner-1', isAdministrator: false });
    await execute(interaction);
    const clicked = await nav(interaction, 'staff_nav_moderacion');

    const editRow = payloadOf(clicked).components[0];
    expect(editRow.components.every((b) => b.data.disabled)).toBe(false);
  });

  it('revalidación server-side: clickear "Canal de logs" sin ser admin lo rechaza igual, aunque el botón debería estar deshabilitado en el cliente', async () => {
    const interaction = makeInteraction({ isAdministrator: false });
    await execute(interaction);
    await nav(interaction, 'staff_nav_moderacion');

    const clicked = { ...interaction, customId: 'staff_edit_modlog_channel', reply: vi.fn().mockResolvedValue(undefined), update: vi.fn().mockResolvedValue(undefined) };
    await routeButton(clicked);

    expect(clicked.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Solo el dueño') }));
    expect(clicked.update).not.toHaveBeenCalled();
  });

  it('admin: click en "Canal de logs" abre el select real de canal', async () => {
    const interaction = makeInteraction({ isAdministrator: true });
    await execute(interaction);
    await nav(interaction, 'staff_nav_moderacion');

    const clicked = await nav(interaction, 'staff_edit_modlog_channel');
    const payload = payloadOf(clicked);
    expect(payload.embeds[0].data.description).toContain('Elegí el canal');
    expect(payload.components[0].components[0].data.custom_id).toBe('staff_modlog_channel_select');
  });

  it('elegir un canal guarda log_channel_moderation_id, audita el cambio y refresca la pantalla con el valor nuevo', async () => {
    const interaction = makeInteraction({ isAdministrator: true });
    await execute(interaction);
    await nav(interaction, 'staff_nav_moderacion');
    await nav(interaction, 'staff_edit_modlog_channel');

    getGuildConfig.mockResolvedValue({ ...FULL_CONFIG, log_channel_moderation_id: 'chan-nuevo' });
    const selected = await navSelect(interaction, 'staff_modlog_channel_select', { values: ['chan-nuevo'] });

    expect(setGuildConfig).toHaveBeenCalledWith('guild-1', { log_channel_moderation_id: 'chan-nuevo' });
    expect(logConfigChange).toHaveBeenCalledWith(selected, expect.stringContaining('chan-nuevo'));
    expect(fieldValue(payloadOf(selected), 'Canal de logs')).toBe('<#chan-nuevo>');
    expect(selected.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('actualizado') }));
  });

  it('dejar el select vacío desactiva el canal de logs (null), no lo deja como estaba', async () => {
    const interaction = makeInteraction({ isAdministrator: true });
    await execute(interaction);
    await nav(interaction, 'staff_nav_moderacion');
    await nav(interaction, 'staff_edit_modlog_channel');

    await navSelect(interaction, 'staff_modlog_channel_select', { values: [] });

    expect(setGuildConfig).toHaveBeenCalledWith('guild-1', { log_channel_moderation_id: null });
  });

  it('revalidación server-side: el select también rechaza a un no-admin aunque dispare el customId directo', async () => {
    const interaction = makeInteraction({ isAdministrator: false });
    const selected = await navSelect(interaction, 'staff_modlog_channel_select', { values: ['chan-x'] });

    expect(selected.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Solo el dueño') }));
    expect(setGuildConfig).not.toHaveBeenCalled();
  });

  it('"Cancelar" vuelve a Moderación sin llamar a setGuildConfig', async () => {
    const interaction = makeInteraction({ isAdministrator: true });
    await execute(interaction);
    await nav(interaction, 'staff_nav_moderacion');
    await nav(interaction, 'staff_edit_modlog_channel');

    const cancelled = await nav(interaction, 'staff_edit_cancel');

    expect(payloadOf(cancelled).embeds[0].data.title).toContain('Moderación');
    expect(setGuildConfig).not.toHaveBeenCalled();
  });

  it('rol de castigo peligroso: se rechaza y NUNCA se llega a guardar', async () => {
    getDangerousRolePermission.mockReturnValue('Administrador');
    const interaction = makeInteraction({ isAdministrator: true });
    await execute(interaction);
    await nav(interaction, 'staff_nav_moderacion');
    await nav(interaction, 'staff_edit_punish_role');

    const selected = await navSelect(interaction, 'staff_punish_role_select', { values: ['role-dangerous'], role: { id: 'role-dangerous' } });

    expect(selected.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Administrador') }));
    expect(setGuildConfig).not.toHaveBeenCalled();
    expect(logConfigChange).not.toHaveBeenCalled();
  });

  it('rol de castigo seguro: se guarda, se audita, y la pantalla refrescada lo muestra', async () => {
    const interaction = makeInteraction({ isAdministrator: true });
    await execute(interaction);
    await nav(interaction, 'staff_nav_moderacion');
    await nav(interaction, 'staff_edit_punish_role');

    getGuildConfig.mockResolvedValue({ ...FULL_CONFIG, punish_role_id: 'role-safe' });
    const selected = await navSelect(interaction, 'staff_punish_role_select', { values: ['role-safe'], role: { id: 'role-safe' } });

    expect(setGuildConfig).toHaveBeenCalledWith('guild-1', { punish_role_id: 'role-safe' });
    expect(logConfigChange).toHaveBeenCalledWith(selected, expect.stringContaining('role-safe'));
    expect(fieldValue(payloadOf(selected), 'Rol de castigo')).toBe('<@&role-safe>');
  });
});

describe('/staff — Fase 3: Economía (solo lectura, sin toggles inventados)', () => {
  it('"Ver economía" muestra circulante real y el top de balances real, con menciones reales', async () => {
    const interaction = makeInteraction();
    await execute(interaction);
    await nav(interaction, 'staff_nav_economia');
    const clicked = await nav(interaction, 'staff_econ_ver');

    const payload = payloadOf(clicked);
    expect(fieldValue(payload, 'Coins en circulación')).toBe('48.200');
    const topValue = fieldValue(payload, 'Top balances');
    expect(topValue).toContain('<@user-rico>');
    expect(topValue).toContain('10.000');
    expect(topValue).toContain('<@user-medio>');
  });

  it('"Ver economía" con un server sin economía todavía no inventa un top vacío como error', async () => {
    getTopBalances.mockResolvedValue([]);
    const interaction = makeInteraction();
    await execute(interaction);
    await nav(interaction, 'staff_nav_economia');
    const clicked = await nav(interaction, 'staff_econ_ver');

    expect(fieldValue(payloadOf(clicked), 'Top balances')).toContain('nadie tiene balance');
  });

  it('"Staff" muestra el modelo de 3 tiers, sin ninguna llamada a datos (es texto fijo)', async () => {
    const interaction = makeInteraction();
    await execute(interaction);
    await nav(interaction, 'staff_nav_economia');
    const clicked = await nav(interaction, 'staff_econ_staff');

    const payload = payloadOf(clicked);
    expect(payload.embeds[0].data.fields.map((f) => f.name)).toEqual(
      expect.arrayContaining(['Tier 1 — Moderador', 'Tier 2 — Administrador', 'Tier 3 — Dueño / Administrator']),
    );
  });

  it('"Límites" muestra los valores reales de /rob y /crime, aclarando que son fijos por código', async () => {
    const interaction = makeInteraction();
    await execute(interaction);
    await nav(interaction, 'staff_nav_economia');
    const clicked = await nav(interaction, 'staff_econ_limites');

    const payload = payloadOf(clicked);
    expect(payload.embeds[0].data.description).toContain('fijos en el código');
    expect(fieldValue(payload, '/rob')).toContain('40%');
    expect(fieldValue(payload, '/crime')).toContain('60%');
  });

  it('"Volver" desde cualquier sub-vista de Economía usa el mismo botón genérico que Moderación y regresa a Economía', async () => {
    const interaction = makeInteraction();
    await execute(interaction);
    await nav(interaction, 'staff_nav_economia');
    await nav(interaction, 'staff_econ_limites');

    const back = await nav(interaction, 'staff_edit_cancel');
    expect(payloadOf(back).embeds[0].data.title).toContain('Economía');
  });
});

function makeRole(id, { position = 1, permissions = { has: () => false } } = {}) {
  return { id, position, permissions, toString: () => `<@&${id}>` };
}

describe('/staff — Fase 4: XP (modo de roles) y Roles (autoasignables)', () => {
  it('bug de Fase 1 corregido: level_roles_mode="replace" ahora se muestra bien (antes comparaba contra un valor que no existía)', async () => {
    getGuildConfig.mockResolvedValue({ ...FULL_CONFIG, level_roles_mode: 'replace' });
    const interaction = makeInteraction();
    await execute(interaction);
    const clicked = await nav(interaction, 'staff_nav_xp');

    expect(fieldValue(payloadOf(clicked), 'Modo de roles')).toContain('Reemplazar');
  });

  it('"Cambiar modo de roles" alterna cumulative -> replace -> ... y audita el cambio', async () => {
    const interaction = makeInteraction({ isAdministrator: true });
    await execute(interaction);
    await nav(interaction, 'staff_nav_xp'); // FULL_CONFIG arranca en 'cumulative'

    // Misma distinción de las otras pruebas de escritura: la lectura ANTES de guardar
    // (para decidir a qué modo alternar) tiene que ver el modo viejo ('cumulative',
    // el default), y la de DESPUÉS (refresco) ya con 'replace'.
    getGuildConfig
      .mockResolvedValueOnce({ ...FULL_CONFIG })
      .mockResolvedValueOnce({ ...FULL_CONFIG, level_roles_mode: 'replace' });
    const clicked = await nav(interaction, 'staff_xp_toggle_mode');

    expect(setGuildConfig).toHaveBeenCalledWith('guild-1', { level_roles_mode: 'replace' });
    expect(fieldValue(payloadOf(clicked), 'Modo de roles')).toContain('Reemplazar');
    expect(logConfigChange).toHaveBeenCalledWith(clicked, expect.stringContaining('Reemplazar'));
  });

  it('revalidación server-side: cambiar el modo sin ser admin se rechaza', async () => {
    const interaction = makeInteraction({ isAdministrator: false });
    const clicked = { ...interaction, customId: 'staff_xp_toggle_mode', reply: vi.fn().mockResolvedValue(undefined), update: vi.fn().mockResolvedValue(undefined) };
    await routeButton(clicked);

    expect(clicked.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Solo el dueño') }));
    expect(setGuildConfig).not.toHaveBeenCalled();
  });

  it('"Quitar autoasignable" está deshabilitado cuando no hay ninguno configurado', async () => {
    getGuildConfig.mockResolvedValue({ ...FULL_CONFIG, selfassignable_roles: [] });
    const interaction = makeInteraction({ isAdministrator: true });
    await execute(interaction);
    const clicked = await nav(interaction, 'staff_nav_roles');

    const editRow = payloadOf(clicked).components[0];
    const removeButton = editRow.components.find((b) => b.data.custom_id === 'staff_selfrole_remove');
    expect(removeButton.data.disabled).toBe(true);
  });

  it('agregar un rol autoasignable seguro: se guarda, se audita, la pantalla refrescada lo muestra', async () => {
    const interaction = makeInteraction({ isAdministrator: true });
    await execute(interaction);
    await nav(interaction, 'staff_nav_roles');
    await nav(interaction, 'staff_selfrole_add');

    const safeRole = makeRole('role-nuevo');
    // 2 lecturas distintas dentro del mismo handler: la 1ra (chequeo de duplicado,
    // ANTES de guardar) tiene que ver la lista vieja; la 2da (refresco de pantalla,
    // DESPUÉS de guardar) tiene que ver la lista ya con el rol nuevo.
    getGuildConfig
      .mockResolvedValueOnce({ ...FULL_CONFIG })
      .mockResolvedValueOnce({ ...FULL_CONFIG, selfassignable_roles: [...FULL_CONFIG.selfassignable_roles, 'role-nuevo'] });
    const selected = await navSelect(interaction, 'staff_selfrole_add_select', { values: ['role-nuevo'], role: safeRole });

    expect(setGuildConfig).toHaveBeenCalledWith('guild-1', { selfassignable_roles: ['role-gaming', 'role-anime', 'role-nuevo'] });
    expect(logConfigChange).toHaveBeenCalledWith(selected, expect.stringContaining('role-nuevo'));
    expect(fieldsOf(payloadOf(selected)).find((f) => f.name.startsWith('Autoasignables'))?.value).toContain('<@&role-nuevo>');
  });

  it('agregar un rol peligroso como autoasignable se rechaza sin guardar nada', async () => {
    getDangerousRolePermission.mockReturnValue('Administrador');
    const interaction = makeInteraction({ isAdministrator: true });
    await execute(interaction);
    await nav(interaction, 'staff_nav_roles');
    await nav(interaction, 'staff_selfrole_add');

    const dangerousRole = makeRole('role-peligroso');
    const selected = await navSelect(interaction, 'staff_selfrole_add_select', { values: ['role-peligroso'], role: dangerousRole });

    expect(selected.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Administrador') }));
    expect(setGuildConfig).not.toHaveBeenCalled();
  });

  it('agregar un rol que el bot no puede asignar (posición igual/superior) se rechaza sin guardar nada', async () => {
    const interaction = makeInteraction({ isAdministrator: true, botRolePosition: 5 });
    await execute(interaction);
    await nav(interaction, 'staff_nav_roles');
    await nav(interaction, 'staff_selfrole_add');

    const tooHighRole = makeRole('role-alto', { position: 10 });
    const selected = await navSelect(interaction, 'staff_selfrole_add_select', { values: ['role-alto'], role: tooHighRole });

    expect(selected.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('posición igual o superior') }));
    expect(setGuildConfig).not.toHaveBeenCalled();
  });

  it('agregar un rol ya existente en la lista avisa sin duplicarlo', async () => {
    const interaction = makeInteraction({ isAdministrator: true });
    await execute(interaction);
    await nav(interaction, 'staff_nav_roles');
    await nav(interaction, 'staff_selfrole_add');

    const already = makeRole('role-gaming');
    const selected = await navSelect(interaction, 'staff_selfrole_add_select', { values: ['role-gaming'], role: already });

    expect(selected.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('ya está') }));
    expect(setGuildConfig).not.toHaveBeenCalled();
  });

  it('"Quitar autoasignable" muestra el select con los roles reales revalidados (resolveLiveSelfRoles)', async () => {
    const interaction = makeInteraction({ isAdministrator: true });
    await execute(interaction);
    await nav(interaction, 'staff_nav_roles');
    const clicked = await nav(interaction, 'staff_selfrole_remove');

    const payload = payloadOf(clicked);
    const options = payload.components[0].components[0].options;
    expect(options.map((o) => o.data.value)).toEqual(['role-gaming', 'role-anime']);
  });

  it('quitar un rol autoasignable: se guarda, se audita, y quienes ya lo tenían lo conservan (mensaje lo aclara)', async () => {
    const interaction = makeInteraction({ isAdministrator: true });
    await execute(interaction);
    await nav(interaction, 'staff_nav_roles');
    await nav(interaction, 'staff_selfrole_remove');

    // Mismo criterio que el test de "agregar": la lectura ANTES de guardar (para
    // calcular el filtro) tiene que ver la lista completa todavía, y la de DESPUÉS
    // (para refrescar la pantalla) ya con el rol sacado — si no se distinguen los dos
    // reads, el test podría pasar por casualidad sin probar la transición real.
    getGuildConfig
      .mockResolvedValueOnce({ ...FULL_CONFIG })
      .mockResolvedValueOnce({ ...FULL_CONFIG, selfassignable_roles: ['role-anime'] });
    const selected = await navSelect(interaction, 'staff_selfrole_remove_select', { values: ['role-gaming'] });

    expect(setGuildConfig).toHaveBeenCalledWith('guild-1', { selfassignable_roles: ['role-anime'] });
    expect(selected.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('conservan') }));
    expect(logConfigChange).toHaveBeenCalledWith(selected, expect.stringContaining('role-gaming'));
  });

  it('revalidación server-side: agregar/quitar autoasignable sin ser admin se rechaza en el select también', async () => {
    const interaction = makeInteraction({ isAdministrator: false });
    const selected = await navSelect(interaction, 'staff_selfrole_remove_select', { values: ['role-gaming'] });

    expect(selected.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Solo el dueño') }));
    expect(setGuildConfig).not.toHaveBeenCalled();
  });

  it('sin roles autoasignables válidos (todos borrados/peligrosos), el select de quitar muestra el mensaje honesto en vez de una lista vacía', async () => {
    resolveLiveSelfRoles.mockResolvedValue([]);
    const interaction = makeInteraction({ isAdministrator: true });
    await execute(interaction);
    await nav(interaction, 'staff_nav_roles');
    const clicked = await nav(interaction, 'staff_selfrole_remove');

    expect(payloadOf(clicked).embeds[0].data.description).toContain('Ya no queda');
  });
});

describe('/staff — Fase 5: Sorteos (datos reales) y Anuncios (lanza el flujo real)', () => {
  it('Sorteos muestra activos/finalizados reales y los premios activos, sin depender de guild_config', async () => {
    const interaction = makeInteraction();
    await execute(interaction);
    const clicked = await nav(interaction, 'staff_nav_sorteos');

    const payload = payloadOf(clicked);
    expect(fieldValue(payload, 'Sorteos activos')).toBe('1');
    expect(fieldValue(payload, 'Finalizados (últimos 25)')).toBe('1');
    expect(fieldValue(payload, 'Premios activos ahora')).toContain('Nitro Classic');
    expect(getGuildConfig).not.toHaveBeenCalled();
    expect(getGuildGiveawaysForAutocomplete).toHaveBeenCalledWith('guild-1', false);
    expect(getGuildGiveawaysForAutocomplete).toHaveBeenCalledWith('guild-1', true);
  });

  it('Sorteos sin ninguno activo no muestra el campo de premios (nunca una lista vacía inventada)', async () => {
    getGuildGiveawaysForAutocomplete.mockResolvedValue([]);
    const interaction = makeInteraction();
    await execute(interaction);
    const clicked = await nav(interaction, 'staff_nav_sorteos');

    const payload = payloadOf(clicked);
    expect(fieldValue(payload, 'Sorteos activos')).toBe('0');
    expect(fieldsOf(payload).some((f) => f.name === 'Premios activos ahora')).toBe(false);
  });

  it('Anuncios muestra las plantillas reales guardadas', async () => {
    const interaction = makeInteraction();
    await execute(interaction);
    const clicked = await nav(interaction, 'staff_nav_anuncios');

    const payload = payloadOf(clicked);
    expect(fieldsOf(payload).find((f) => f.name.startsWith('Plantillas'))?.name).toBe('Plantillas guardadas (1)');
    expect(fieldValue(payload, 'Plantillas guardadas (1)')).toContain('Mantenimiento');
  });

  it('"Crear anuncio" lanza el flujo REAL de /anuncio (startBuilder) en vez de reimplementarlo', async () => {
    const interaction = makeInteraction();
    await execute(interaction);
    await nav(interaction, 'staff_nav_anuncios');

    const clicked = { ...interaction, customId: 'staff_anuncio_crear', update: vi.fn().mockResolvedValue(undefined) };
    await routeButton(clicked);

    expect(startAnuncioBuilder).toHaveBeenCalledWith(clicked);
    // No reimplementa nada del panel de anuncio: nunca llama a i.update() por su cuenta,
    // eso es responsabilidad exclusiva de startBuilder (que hace su propio i.reply()).
    expect(clicked.update).not.toHaveBeenCalled();
  });
});
