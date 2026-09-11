// Staff Control Center — Fase 1 (esqueleto de navegación). Un solo panel efímero
// (mismo patrón que /setup y /anuncio: embed + botones, i.update() para navegar sin
// generar mensajes nuevos) que reemplaza la necesidad de memorizar comandos sueltos
// para las tareas más comunes de administración. Los comandos existentes (/config,
// /rol-nivel, /warn, etc.) NO se tocan ni se reemplazan — este panel es una capa de
// navegación por encima, nunca duplica su lógica: todo lo que se muestra acá sale de
// leer guild_config con getGuildConfig(), la misma función que ya usan /config y
// /help.
//
// ALCANCE DE FASE 1: solo lectura. Los módulos que necesitan una fuente de datos nueva
// (sorteos activos, plantillas de anuncios, estadísticas semanales, catálogo de
// misiones/logros) muestran un placeholder honesto en vez de inventar números — se
// conectan en su propia fase.
//
// FASE 2 (Moderación funcional): primera escritura real. Solo 2 campos, elegidos a
// propósito por ser los únicos de Moderación con un camino de escritura simple y
// reversible ("vacío para desactivar"): canal de logs de moderación y rol de castigo.
// moderator_role_id/admin_role_id quedan FUERA de esta fase — admin_role_id es
// sensible (PERM-1, sin opción de vaciar, ver config.js) y moderator_role_id no tiene
// hoy ni siquiera un /config dedicado (solo lo fija /setup) — mezclar esos dos con la
// primera escritura del panel es más riesgo del que esta fase necesita asumir.
// Cada escritura reusa exactamente lo que ya usa /config para el mismo campo, nunca
// una versión propia: mismo gate (dueño o Administrator — /config lo exige para TODO
// el comando, así que /staff lo replica acá en vez de conformarse con el isStaff() más
// laxo del resto del panel), mismo getDangerousRolePermission() para el rol de
// castigo, y el mismo logConfigChange() (exportado de config.js para esto) para que
// el canal de logs de actividad vea auditado un cambio hecho desde /staff exactamente
// igual que uno hecho desde /config — nunca un bypass silencioso del audit trail.
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import { getGuildConfig, setGuildConfig } from '../../utils/guildConfigStore.js';
import { isStaff, getDangerousRolePermission } from '../../utils/permissions.js';
import { pingSupabase } from '../../supabaseClient.js';
import { getMissingBotPermissions } from '../../utils/botPermissions.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { registerButtonPrefix } from '../../components/buttons.js';
import { registerSelectPrefix } from '../../components/selects.js';
import { logConfigChange } from './config.js';

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutos, mismo criterio que /setup y /anuncio

// Sesión en memoria: solo guarda el STACK de navegación (breadcrumb), nunca un draft —
// esta fase no tiene ningún formulario que perder. Key SIEMPRE `${guildId}:${userId}`
// desde el día uno (auditoría adversarial round 2, Bloque 1: /setup y /anuncio tenían
// esto mal — keyeados solo por userId — y un mismo staff en 2+ servidores se pisaba la
// sesión entre uno y otro).
const sessions = new Map();

function sessionKey(guildId, userId) {
  return `${guildId}:${userId}`;
}
function getStack(key) {
  return sessions.get(key)?.stack || null;
}
function setStack(key, stack) {
  const existing = sessions.get(key);
  if (existing?.timeoutHandle) clearTimeout(existing.timeoutHandle);
  const timeoutHandle = setTimeout(() => sessions.delete(key), SESSION_TTL_MS);
  sessions.set(key, { stack, timeoutHandle });
}

// ---------- Mapa de pantallas ----------

const SCREEN_META = {
  home: { icon: '🏠', label: 'NEXO STAFF' },
  config: { icon: '⚙️', label: 'Configuración' },
  moderacion: { icon: '🛡️', label: 'Moderación' },
  economia: { icon: '💰', label: 'Economía' },
  xp: { icon: '⭐', label: 'XP y niveles' },
  roles: { icon: '🎭', label: 'Roles' },
  sorteos: { icon: '🎁', label: 'Sorteos' },
  anuncios: { icon: '📢', label: 'Anuncios' },
  minijuegos: { icon: '🎮', label: 'Minijuegos' },
  misiones: { icon: '🎯', label: 'Misiones' },
  logros: { icon: '🏆', label: 'Logros' },
  estadisticas: { icon: '📊', label: 'Estadísticas' },
  sistema: { icon: '🔧', label: 'Sistema' },
  bienvenida: { icon: '👋', label: 'Bienvenida' },
  digest: { icon: '📈', label: 'Digest semanal' },
  canales: { icon: '📺', label: 'Canales' },
};

// Grilla del home — 12 módulos, 4 por fila (3 filas, dentro del límite de Discord de 5
// filas x 5 componentes).
const HOME_MODULES = [
  'config', 'moderacion', 'economia', 'xp', 'sorteos', 'roles',
  'anuncios', 'minijuegos', 'misiones', 'logros', 'estadisticas', 'sistema',
];

// Submenú de Configuración — comparte pantallas con la grilla del home donde se
// solapan (moderación, economía, xp, roles, sorteos, anuncios, misiones) y agrega 3
// que NO son mosaico propio del home (bienvenida, digest, canales) — mismo criterio
// de information architecture que la preview HTML original.
const CONFIG_ITEMS = [
  'moderacion', 'economia', 'xp', 'roles', 'sorteos',
  'anuncios', 'bienvenida', 'digest', 'misiones', 'canales',
];

// Módulos que todavía no tienen una fuente de datos real conectada — placeholder
// honesto en vez de un número inventado (ver la nota de alcance arriba).
const PLACEHOLDER_SCREENS = new Set(['sorteos', 'anuncios', 'minijuegos', 'misiones', 'logros', 'estadisticas']);

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function moduleButtonRows(ids, perRow) {
  return chunk(ids, perRow).map((group) =>
    new ActionRowBuilder().addComponents(
      group.map((id) =>
        new ButtonBuilder().setCustomId(`staff_nav_${id}`).setLabel(SCREEN_META[id].label).setEmoji(SCREEN_META[id].icon).setStyle(ButtonStyle.Secondary),
      ),
    ),
  );
}

// Fila de navegación al pie de cada pantalla — en el home solo tiene "Cerrar" (no hay
// a dónde volver); en el resto, Volver + Inicio + Cerrar.
function navRow(screen) {
  const buttons = [];
  if (screen !== 'home') {
    buttons.push(new ButtonBuilder().setCustomId('staff_back').setLabel('Volver').setEmoji('🔙').setStyle(ButtonStyle.Secondary));
    buttons.push(new ButtonBuilder().setCustomId('staff_home').setLabel('Inicio').setEmoji('🏠').setStyle(ButtonStyle.Secondary));
  }
  buttons.push(new ButtonBuilder().setCustomId('staff_close').setLabel('Cerrar').setEmoji('✖️').setStyle(ButtonStyle.Danger));
  return new ActionRowBuilder().addComponents(buttons);
}

function baseEmbed(screen) {
  const meta = SCREEN_META[screen];
  return new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`${meta.icon} ${meta.label}`).setFooter({ text: BRAND_NAME });
}

// Mismo gate que /config exige para el comando ENTERO (config.js línea ~150) —
// replicado acá porque /staff es un solo comando compartido por los 3 tiers: isStaff()
// (el gate de entrada de /staff) alcanza para VER esta pantalla, pero cualquier
// escritura sobre guild_config necesita el mismo piso que /config, no el más laxo de
// isStaff().
function isOwnerOrAdmin(interaction) {
  return interaction.guild.ownerId === interaction.user.id || interaction.member.permissions.has(PermissionFlagsBits.Administrator);
}

// ---------- Pantallas ----------

function buildHomeScreen(interaction) {
  const gatewayLabel = interaction.client.ws.ping < 0 ? '🟡 Reconectando…' : `🟢 Operativo (${interaction.client.ws.ping}ms)`;
  const embed = baseEmbed('home')
    .setDescription('Centro de administración del servidor. Elegí un módulo para empezar.')
    .addFields(
      { name: 'Servidor', value: interaction.guild.name, inline: true },
      { name: 'ID', value: interaction.guild.id, inline: true },
      { name: 'Estado de NEXO', value: gatewayLabel, inline: true },
    )
    .setTimestamp();
  return { embeds: [embed], components: [...moduleButtonRows(HOME_MODULES, 4), navRow('home')] };
}

function buildConfigScreen() {
  const embed = baseEmbed('config').setDescription('Elegí qué querés configurar. Cada opción abre su propio panel.');
  return { embeds: [embed], components: [...moduleButtonRows(CONFIG_ITEMS, 5), navRow('config')] };
}

function buildModeracionScreen(cfg, interaction) {
  const role = (id) => (id ? `<@&${id}>` : '❌ Sin configurar');
  const canEdit = isOwnerOrAdmin(interaction);
  const embed = baseEmbed('moderacion').addFields(
    { name: 'Módulo', value: cfg.features?.moderacion ? '🟢 Activado' : '🔴 Desactivado', inline: true },
    { name: 'Rol de moderador', value: role(cfg.moderator_role_id), inline: true },
    { name: 'Rol de administrador', value: role(cfg.admin_role_id), inline: true },
    { name: 'Rol de castigo', value: role(cfg.punish_role_id), inline: true },
    { name: 'Canal de logs', value: cfg.log_channel_moderation_id ? `<#${cfg.log_channel_moderation_id}>` : '❌ Sin configurar', inline: true },
  );
  embed.setFooter({
    text: canEdit
      ? 'Rol de moderador/administrador: usá /config mientras tanto (llegan a este panel más adelante).'
      : '🔒 Editar requiere ser dueño o Administrator — el resto se ve, pero no se puede tocar desde acá.',
  });
  const editRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('staff_edit_modlog_channel').setLabel('Canal de logs').setEmoji('🔧').setStyle(ButtonStyle.Secondary).setDisabled(!canEdit),
    new ButtonBuilder().setCustomId('staff_edit_punish_role').setLabel('Rol de castigo').setEmoji('🔧').setStyle(ButtonStyle.Secondary).setDisabled(!canEdit),
  );
  return { embeds: [embed], components: [editRow, navRow('moderacion')] };
}

// ---------- Sub-vistas de edición (Fase 2) ----------
// No son "pantallas" del breadcrumb (no empujan el stack de navegación) — son un
// estado transitorio sobre la MISMA pantalla de Moderación, mismo criterio que un
// modal: se sale con "Guardar" (el select dispara solo) o "Cancelar", nunca con
// "Volver".

function buildModlogChannelEditView() {
  const embed = baseEmbed('moderacion').setDescription(
    'Elegí el canal donde se van a mandar los logs de moderación (warns, bans, kicks, timeouts…). Dejalo vacío para desactivarlo.',
  );
  const selectRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('staff_modlog_channel_select')
      .setPlaceholder('Elegí un canal de texto (opcional)')
      .addChannelTypes(ChannelType.GuildText)
      .setMinValues(0)
      .setMaxValues(1),
  );
  const cancelRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('staff_edit_cancel').setLabel('Cancelar').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [selectRow, cancelRow] };
}

function buildPunishRoleEditView() {
  const embed = baseEmbed('moderacion').setDescription(
    'Elegí el rol de castigo (lo usan /punish y /unpunish para restringir imágenes/enlaces). Dejalo vacío para desactivarlo.',
  );
  const selectRow = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder().setCustomId('staff_punish_role_select').setPlaceholder('Elegí un rol (opcional)').setMinValues(0).setMaxValues(1),
  );
  const cancelRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('staff_edit_cancel').setLabel('Cancelar').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [selectRow, cancelRow] };
}

function buildEconomiaScreen() {
  const embed = baseEmbed('economia')
    .setDescription('El sistema económico de NEXO está **siempre activo** — a diferencia de moderación/XP, no tiene un interruptor propio.')
    .addFields({ name: 'Comandos disponibles', value: '`/daily` `/work` `/crime` `/rob` `/coinflip` `/dado` `/slots` `/ruleta` `/bank` `/shop`' });
  embed.setFooter({ text: 'Panorama económico en vivo (balances, circulante) llega en la próxima fase.' });
  return { embeds: [embed], components: [navRow('economia')] };
}

function buildXpScreen(cfg) {
  const levelRolesCount = Object.keys(cfg.level_roles || {}).length;
  const embed = baseEmbed('xp').addFields(
    { name: 'Módulo', value: cfg.features?.xp ? '🟢 Activado' : '🔴 Desactivado', inline: true },
    { name: 'Roles por nivel', value: `${levelRolesCount} configurado(s)`, inline: true },
    { name: 'Modo de roles', value: cfg.level_roles_mode === 'highest_only' ? 'Solo el más alto' : 'Acumulativo', inline: true },
    { name: 'Boost de fin de semana', value: cfg.xp_weekend_boost ? '🟢 Activado' : '🔴 Desactivado', inline: true },
  );
  embed.setFooter({ text: 'Edición disponible en la próxima fase — usá /rol-nivel y /modo-roles-nivel mientras tanto.' });
  return { embeds: [embed], components: [navRow('xp')] };
}

function buildRolesScreen(cfg) {
  const selfRoles = cfg.selfassignable_roles || [];
  const levelRolesCount = Object.keys(cfg.level_roles || {}).length;
  const embed = baseEmbed('roles').addFields(
    { name: `Autoasignables (${selfRoles.length})`, value: selfRoles.length ? selfRoles.map((id) => `<@&${id}>`).join(', ').slice(0, 1000) : '❌ Ninguno configurado' },
    { name: 'Por nivel', value: `${levelRolesCount} configurado(s)`, inline: true },
    { name: 'Rol automático', value: cfg.auto_role_id ? `<@&${cfg.auto_role_id}>` : '❌ Sin configurar', inline: true },
  );
  embed.setFooter({ text: 'Edición disponible en la próxima fase — usá /config rol-autoasignable-agregar mientras tanto.' });
  return { embeds: [embed], components: [navRow('roles')] };
}

function buildDigestScreen(cfg) {
  const lastSent = cfg.weekly_digest_last_sent_at ? `<t:${Math.floor(cfg.weekly_digest_last_sent_at / 1000)}:R>` : 'Nunca';
  const embed = baseEmbed('digest').addFields(
    { name: 'Estado', value: cfg.weekly_digest_enabled ? '🟢 Activado' : '🔴 Desactivado', inline: true },
    { name: 'Canal', value: cfg.log_channel_activity_id ? `<#${cfg.log_channel_activity_id}>` : '❌ Sin canal de actividad configurado', inline: true },
    { name: 'Último envío', value: lastSent, inline: true },
  );
  embed.setFooter({ text: 'Edición disponible en la próxima fase — usá /config digest-semanal mientras tanto.' });
  return { embeds: [embed], components: [navRow('digest')] };
}

function buildBienvenidaScreen(cfg) {
  const embed = baseEmbed('bienvenida').addFields({
    name: 'Canal',
    value: cfg.welcome_channel_id ? `<#${cfg.welcome_channel_id}>` : '❌ Sin configurar',
  });
  embed.setFooter({ text: 'Edición disponible en la próxima fase — usá /setup (extra "Bienvenida") o /config canal-bienvenida mientras tanto.' });
  return { embeds: [embed], components: [navRow('bienvenida')] };
}

function buildCanalesScreen(cfg) {
  const ch = (id) => (id ? `<#${id}>` : '❌ Sin configurar');
  const embed = baseEmbed('canales')
    .setDescription('Todos los canales que NEXO usa en este servidor, en un solo lugar.')
    .addFields(
      { name: 'Logs de moderación', value: ch(cfg.log_channel_moderation_id), inline: true },
      { name: 'Logs de actividad', value: ch(cfg.log_channel_activity_id), inline: true },
      { name: 'Logs de economía', value: ch(cfg.log_channel_economy_id), inline: true },
      { name: 'Bienvenida', value: ch(cfg.welcome_channel_id), inline: true },
      { name: 'Confesiones', value: ch(cfg.confession_channel_id), inline: true },
    );
  embed.setFooter({ text: 'Cambiar un canal estará disponible en la próxima fase — usá /config mientras tanto.' });
  return { embeds: [embed], components: [navRow('canales')] };
}

// Único módulo con datos 100% reales desde esta misma fase: es puramente de lectura
// (nunca va a tener una acción de "editar", por eso no hay razón para posponerlo) y
// reusa exactamente las mismas fuentes que ya usa /estado — sin duplicar esa lógica.
async function buildSistemaScreen(interaction) {
  const supabaseStatus = await pingSupabase();
  const SUPABASE_SLOW_MS = 1000;
  const supabaseLabel = !supabaseStatus.ok
    ? '❌ Sin conexión'
    : supabaseStatus.ms > SUPABASE_SLOW_MS
      ? `🟡 Lento (${supabaseStatus.ms}ms)`
      : `✅ OK (${supabaseStatus.ms}ms)`;
  const gatewayLabel = interaction.client.ws.ping < 0 ? '🟡 Reconectando…' : `${interaction.client.ws.ping}ms`;
  const onlineSinceTimestamp = Math.floor((Date.now() - interaction.client.uptime) / 1000);
  const missingPermissions = getMissingBotPermissions(interaction.guild);

  const embed = baseEmbed('sistema').addFields(
    { name: '📡 Latencia (gateway)', value: gatewayLabel, inline: true },
    { name: '🗄️ Supabase', value: supabaseLabel, inline: true },
    { name: '🌐 Servidores totales', value: `${interaction.client.guilds.cache.size}`, inline: true },
    { name: '⏱️ En línea desde', value: `<t:${onlineSinceTimestamp}:R>`, inline: true },
    {
      name: '🔐 Permisos del bot',
      value: missingPermissions.length === 0 ? '✅ Todo OK' : missingPermissions.map((p) => `⚠️ **${p.label}**`).join('\n').slice(0, 1000),
    },
  );
  embed.setFooter({ text: 'Mismos datos que /estado.' });
  return { embeds: [embed], components: [navRow('sistema')] };
}

function buildPlaceholderScreen(screen) {
  const embed = baseEmbed(screen).setDescription('🚧 Este módulo todavía no está conectado a datos reales — llega en una fase siguiente del Staff Control Center.');
  return { embeds: [embed], components: [navRow(screen)] };
}

async function buildScreen(screen, interaction) {
  if (screen === 'home') return buildHomeScreen(interaction);
  if (screen === 'config') return buildConfigScreen();
  if (screen === 'sistema') return buildSistemaScreen(interaction);
  if (PLACEHOLDER_SCREENS.has(screen)) return buildPlaceholderScreen(screen);

  const cfg = await getGuildConfig(interaction.guildId);
  if (screen === 'moderacion') return buildModeracionScreen(cfg, interaction);
  if (screen === 'economia') return buildEconomiaScreen();
  if (screen === 'xp') return buildXpScreen(cfg);
  if (screen === 'roles') return buildRolesScreen(cfg);
  if (screen === 'digest') return buildDigestScreen(cfg);
  if (screen === 'bienvenida') return buildBienvenidaScreen(cfg);
  if (screen === 'canales') return buildCanalesScreen(cfg);

  return buildPlaceholderScreen(screen); // seguro contra un customId inesperado — nunca debería alcanzarse
}

// ---------- Comando ----------

export const data = new SlashCommandBuilder()
  .setName('staff')
  .setDescription('Panel de administración de NEXO — moderación, economía, XP, roles y más, sin memorizar comandos.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!(await isStaff(interaction))) {
    await interaction.reply({ content: '❌ No tenés permisos para usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  const key = sessionKey(interaction.guildId, interaction.user.id);
  setStack(key, ['home']);
  const payload = buildHomeScreen(interaction);
  await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

registerButtonPrefix('staff_nav_', async (i) => {
  const key = sessionKey(i.guildId, i.user.id);
  // Sesión vencida/cerrada: no hay ningún draft que perder en esta fase, así que
  // simplemente se arranca un stack nuevo en vez de mostrar un error de "expiró" —
  // a diferencia de /setup, acá no hay ninguna consecuencia real de negocio.
  const stack = getStack(key) || ['home'];
  const screen = i.customId.replace('staff_nav_', '');
  stack.push(screen);
  setStack(key, stack);
  await i.update(await buildScreen(screen, i));
});

registerButtonPrefix('staff_back', async (i) => {
  const key = sessionKey(i.guildId, i.user.id);
  const stack = getStack(key) || ['home'];
  if (stack.length > 1) stack.pop();
  setStack(key, stack);
  await i.update(await buildScreen(stack[stack.length - 1], i));
});

registerButtonPrefix('staff_home', async (i) => {
  const key = sessionKey(i.guildId, i.user.id);
  setStack(key, ['home']);
  await i.update(buildHomeScreen(i));
});

registerButtonPrefix('staff_close', async (i) => {
  const key = sessionKey(i.guildId, i.user.id);
  sessions.delete(key);
  await i.update({ content: '✅ Panel cerrado.', embeds: [], components: [] });
});

// ---------- Fase 2: edición de Moderación ----------
// Gate revalidado ACÁ, no solo en el render del botón: un botón deshabilitado ya
// impide el click en el cliente de Discord, pero nunca hay que confiar en eso como
// única defensa (mismo criterio que el resto del proyecto — un customId se puede
// disparar por otras vías, ej. un cliente modificado).

registerButtonPrefix('staff_edit_modlog_channel', async (i) => {
  if (!isOwnerOrAdmin(i)) {
    return i.reply({ content: '❌ Solo el dueño del servidor o un administrador puede cambiar esto.', flags: MessageFlags.Ephemeral });
  }
  await i.update(buildModlogChannelEditView());
});

registerButtonPrefix('staff_edit_punish_role', async (i) => {
  if (!isOwnerOrAdmin(i)) {
    return i.reply({ content: '❌ Solo el dueño del servidor o un administrador puede cambiar esto.', flags: MessageFlags.Ephemeral });
  }
  await i.update(buildPunishRoleEditView());
});

// Sale de la sub-vista de edición SIN guardar nada — vuelve a la Moderación real
// (nunca al tope del stack de navegación: esta sub-vista nunca lo empujó).
registerButtonPrefix('staff_edit_cancel', async (i) => {
  const cfg = await getGuildConfig(i.guildId);
  await i.update(buildModeracionScreen(cfg, i));
});

registerSelectPrefix('staff_modlog_channel_select', async (i) => {
  if (!isOwnerOrAdmin(i)) {
    return i.reply({ content: '❌ Solo el dueño del servidor o un administrador puede cambiar esto.', flags: MessageFlags.Ephemeral });
  }
  const channelId = i.values[0] ?? null;
  await setGuildConfig(i.guildId, { log_channel_moderation_id: channelId });

  const cfg = await getGuildConfig(i.guildId);
  await i.update(buildModeracionScreen(cfg, i));
  await i.followUp({
    content: channelId ? `✅ Canal de logs de moderación actualizado a <#${channelId}>.` : '✅ Canal de logs de moderación desactivado.',
    flags: MessageFlags.Ephemeral,
  });
  await logConfigChange(i, channelId ? `🛡️ Canal de logs de moderación → <#${channelId}> (desde /staff)` : '🛡️ Canal de logs de moderación desactivado (desde /staff)');
});

registerSelectPrefix('staff_punish_role_select', async (i) => {
  if (!isOwnerOrAdmin(i)) {
    return i.reply({ content: '❌ Solo el dueño del servidor o un administrador puede cambiar esto.', flags: MessageFlags.Ephemeral });
  }
  const roleId = i.values[0] ?? null;
  if (roleId) {
    const role = i.roles?.first();
    const dangerousPermission = role ? getDangerousRolePermission(role) : null;
    if (dangerousPermission) {
      return i.reply({
        content: `❌ Ese rol tiene el permiso **${dangerousPermission}**, así que no se puede usar como rol de castigo — el bot se lo agregaría a cualquier usuario sancionado, entregándole ese permiso por error. Elegí (o creá) un rol sin privilegios administrativos.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
  await setGuildConfig(i.guildId, { punish_role_id: roleId });

  const cfg = await getGuildConfig(i.guildId);
  await i.update(buildModeracionScreen(cfg, i));
  await i.followUp({
    content: roleId ? `✅ Rol de castigo actualizado a <@&${roleId}>.` : '✅ Rol de castigo desactivado.',
    flags: MessageFlags.Ephemeral,
  });
  await logConfigChange(i, roleId ? `🚫 Rol de castigo → <@&${roleId}> (desde /staff)` : '🚫 Rol de castigo desactivado (desde /staff)');
});
