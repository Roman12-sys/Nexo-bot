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
//
// FASE 3 (Economía, solo lectura — sin escritura nueva): la preview HTML original
// (y el plan de trabajo inicial) asumía toggles por-comando (daily/work/crime/rob/
// casino/banco) — investigado a fondo, esos toggles NO EXISTEN en el modelo real:
// guild_config nunca tuvo columnas de features para economía (el toggle "Economía"
// se sacó de /setup en 2026-08-29 explícitamente porque no gateaba nada — ver
// setup.js). No se inventa esa capacidad acá: la economía es siempre activa, punto,
// y el panel lo dice así en vez de simular un interruptor que no hace nada. Lo que sí
// se conecta es circulante real (sum_guild_balances, RPC de Fase 2C) y top de
// balances reales (mismo criterio ya usado por dashboard/queries.js, ahora también
// disponible del lado del bot vía economyStore.js).
//
// FASE 4 (XP/Roles funcional): modo de roles de nivel (toggle simple, cumulative ⇄
// replace) y agregar/quitar roles autoasignables — este último reusa
// resolveLiveSelfRoles() de selfRoles.js TAL CUAL (la misma revalidación en vivo que
// ya protege el menú real de "Mis roles"), en vez de una versión propia. Agregar un
// rol de nivel puntual (rol-nivel, nivel+rol juntos) queda FUERA de esta fase — Discord
// no permite combinar un select de rol con un input numérico fuera de un modal, y un
// modal no admite selects: necesita un flujo de 2 pasos que se diseña con más cuidado
// en una fase propia, no se improvisa acá.
//
// FASE 5 (Sorteos/Anuncios): asimétrica a propósito. Anuncios tenía desde su diseño
// original una función exportada para arrancar el builder desde cualquier entrada
// (startBuilder en anuncio.js, ya reusada por /anuncio y por el mensaje con
// prefill de color/imagen/mención) — "Crear anuncio" la llama directo, cero código
// nuevo de UI. Sorteos NO tiene ese mismo diseño: /sorteo crear lee sus 4 campos
// (premio, duración, ganadores, canal) directo de `interaction.options`, algo que
// una interacción de botón no tiene — armar un flujo equivalente necesita un modal +
// decisiones de UX propias (Discord no deja combinar un modal con un select de canal
// en el mismo paso), así que "Crear sorteo" queda fuera de esta fase a propósito. Lo
// que SÍ se conecta acá son datos reales de sorteos (activos/finalizados, misma
// función que ya usa /estado y el autocomplete de /sorteo) y de anuncios (plantillas
// guardadas reales).
//
// FASE 6 (Digest/Estadísticas/Sistema): Sistema ya quedó 100% real desde la Fase 1
// (nunca tuvo motivo para esperar, es puramente de lectura). Digest gana su única
// escritura real posible — activar/desactivar, MISMA semántica exacta que /config
// digest-semanal (sembrar weekly_digest_last_sent_at al activar, limpiarlo al
// desactivar) — nunca hubo campos de "día"/"hora" que inventar: esas columnas no
// existen, el digest corre cada 1h chequeando si ya pasaron 7 días reales desde el
// último envío, sin horario fijo. Estadísticas conecta guild_daily_stats (mismo dato
// que ya usa el dashboard) sumado en los últimos 7 días — un pulso rápido, no un
// reemplazo del desglose diario del dashboard.
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import { getGuildConfig, setGuildConfig } from '../../utils/guildConfigStore.js';
import { getGuildCirculatingBalance, getTopBalances } from '../../utils/economyStore.js';
import { isStaff, getDangerousRolePermission } from '../../utils/permissions.js';
import { resolveLiveSelfRoles } from '../../utils/selfRoles.js';
import { getGuildGiveawaysForAutocomplete } from '../../utils/giveawaysStore.js';
import { getGuildAnnouncementTemplates } from '../../utils/announcementTemplatesStore.js';
import { getGuildDailyStats } from '../../utils/guildDailyStatsStore.js';
import { startBuilder as startAnuncioBuilder } from '../anuncios/anuncio.js';
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
const PLACEHOLDER_SCREENS = new Set(['minijuegos', 'misiones', 'logros']);

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

async function buildEconomiaScreen(guildId) {
  const circulating = await getGuildCirculatingBalance(guildId);
  const embed = baseEmbed('economia')
    .setDescription('El sistema económico de NEXO está **siempre activo** — a diferencia de moderación/XP, no tiene un interruptor propio.')
    .addFields(
      { name: 'Coins en circulación', value: `${circulating.toLocaleString('es-AR')}`, inline: true },
      { name: 'Comandos disponibles', value: '`/daily` `/work` `/crime` `/rob` `/coinflip` `/dado` `/slots` `/ruleta` `/bank` `/shop`' },
    );
  embed.setFooter({ text: BRAND_NAME });
  const buttonsRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('staff_econ_ver').setLabel('Ver economía').setEmoji('📊').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('staff_econ_limites').setLabel('Límites').setEmoji('📏').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('staff_econ_staff').setLabel('Staff').setEmoji('👮').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [buttonsRow, navRow('economia')] };
}

// ---------- Sub-vistas de Economía (Fase 3, todas de solo lectura) ----------

async function buildEconomiaVerView(guildId) {
  const [circulating, top] = await Promise.all([getGuildCirculatingBalance(guildId), getTopBalances(guildId, 5)]);
  const embed = baseEmbed('economia').setTitle('💰 Economía — panorama').addFields({
    name: 'Coins en circulación',
    value: `${circulating.toLocaleString('es-AR')}`,
  });
  embed.addFields({
    name: 'Top balances',
    value: top.length ? top.map((u, i) => `**#${i + 1}** <@${u.userId}> — ${u.balance.toLocaleString('es-AR')}`).join('\n') : 'Todavía nadie tiene balance en este servidor.',
  });
  const backRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('staff_edit_cancel').setLabel('Volver').setEmoji('↩️').setStyle(ButtonStyle.Secondary));
  return { embeds: [embed], components: [backRow] };
}

function buildEconomiaStaffView() {
  const embed = baseEmbed('economia')
    .setTitle('👮 Economía — permisos de staff')
    .setDescription('Modelo de 3 tiers de NEXO (PERM-1) aplicado a economía.')
    .addFields(
      { name: 'Tier 1 — Moderador', value: 'Moderación completa. No puede tocar economía de otros usuarios.' },
      { name: 'Tier 2 — Administrador', value: 'Único tier (además del dueño) que puede usar `/economia-staff` y `/xp` para acreditar balance/XP sin límite.' },
      { name: 'Tier 3 — Dueño / Administrator', value: '`/setup`, `/config`, y todo lo del Tier 2.' },
    );
  embed.setFooter({ text: 'Ver la sección "Permisos" de CLAUDE.md para el detalle completo de este modelo.' });
  const backRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('staff_edit_cancel').setLabel('Volver').setEmoji('↩️').setStyle(ButtonStyle.Secondary));
  return { embeds: [embed], components: [backRow] };
}

function buildEconomiaLimitesView() {
  const embed = baseEmbed('economia')
    .setTitle('📏 Economía — límites')
    .setDescription(
      'Estos valores son **fijos en el código, iguales para todos los servidores** — no son un ajuste por-servidor en guild_config, ' +
        'así que no hay nada que "guardar" acá. Mostrados solo como referencia rápida.',
    )
    .addFields(
      { name: '/rob', value: 'Éxito 40% · roba 10-25% del wallet de la víctima (tope 5.000) · si falla, multa 5-15% (tope 2.000, va a la víctima) · escudo de víctima 3h · cooldown del atacante 1h', inline: false },
      { name: '/crime', value: 'Éxito 60% · cooldown 45 min · paga 150-400 si sale bien · multa 50-150 si falla (se destruye, no va a nadie — sumidero real)', inline: false },
    );
  embed.setFooter({ text: 'Convertir esto en un ajuste por-servidor sería una feature nueva, no algo que este panel ya tenga para mostrar.' });
  const backRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('staff_edit_cancel').setLabel('Volver').setEmoji('↩️').setStyle(ButtonStyle.Secondary));
  return { embeds: [embed], components: [backRow] };
}

// FASE 4 (XP/Roles funcional) — bug real corregido de paso: el valor real de
// level_roles_mode es 'cumulative' | 'replace' (ver config.js modo-roles-nivel), NO
// 'highest_only' — la Fase 1 comparaba contra un valor que nunca existió, así que
// SIEMPRE mostraba "Acumulativo" sin importar el modo real configurado.
function levelRolesModeLabel(mode) {
  return mode === 'replace' ? 'Reemplazar (solo el más alto)' : 'Acumulativo (te quedás con todos)';
}

function buildXpScreen(cfg, interaction) {
  const levelRolesCount = Object.keys(cfg.level_roles || {}).length;
  const canEdit = isOwnerOrAdmin(interaction);
  const embed = baseEmbed('xp').addFields(
    { name: 'Módulo', value: cfg.features?.xp ? '🟢 Activado' : '🔴 Desactivado', inline: true },
    { name: 'Roles por nivel', value: `${levelRolesCount} configurado(s)`, inline: true },
    { name: 'Modo de roles', value: levelRolesModeLabel(cfg.level_roles_mode), inline: true },
    { name: 'Boost de fin de semana', value: cfg.xp_weekend_boost ? '🟢 Activado' : '🔴 Desactivado', inline: true },
  );
  embed.setFooter({
    text: canEdit
      ? 'Agregar/quitar un rol de nivel puntual: usá /config rol-nivel mientras tanto (llega a este panel más adelante).'
      : '🔒 Cambiar el modo requiere ser dueño o Administrator.',
  });
  const editRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('staff_xp_toggle_mode').setLabel('Cambiar modo de roles').setEmoji('🔁').setStyle(ButtonStyle.Secondary).setDisabled(!canEdit),
  );
  return { embeds: [embed], components: [editRow, navRow('xp')] };
}

function buildRolesScreen(cfg, interaction) {
  const selfRoles = cfg.selfassignable_roles || [];
  const levelRolesCount = Object.keys(cfg.level_roles || {}).length;
  const canEdit = isOwnerOrAdmin(interaction);
  const embed = baseEmbed('roles').addFields(
    { name: `Autoasignables (${selfRoles.length})`, value: selfRoles.length ? selfRoles.map((id) => `<@&${id}>`).join(', ').slice(0, 1000) : '❌ Ninguno configurado' },
    { name: 'Por nivel', value: `${levelRolesCount} configurado(s)`, inline: true },
    { name: 'Rol automático', value: cfg.auto_role_id ? `<@&${cfg.auto_role_id}>` : '❌ Sin configurar', inline: true },
  );
  embed.setFooter({
    text: canEdit
      ? 'Agregar/quitar un rol de nivel puntual: usá /config rol-nivel mientras tanto (llega a este panel más adelante).'
      : '🔒 Agregar/quitar autoasignables requiere ser dueño o Administrator.',
  });
  const editRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('staff_selfrole_add').setLabel('Agregar autoasignable').setEmoji('➕').setStyle(ButtonStyle.Secondary).setDisabled(!canEdit),
    new ButtonBuilder().setCustomId('staff_selfrole_remove').setLabel('Quitar autoasignable').setEmoji('➖').setStyle(ButtonStyle.Secondary).setDisabled(!canEdit || selfRoles.length === 0),
  );
  return { embeds: [embed], components: [editRow, navRow('roles')] };
}

// ---------- Sub-vistas de edición: XP/Roles (Fase 4) ----------

function buildSelfRoleAddView() {
  const embed = baseEmbed('roles').setDescription('Elegí el rol que los miembros van a poder elegirse solos desde `/help` ("Mis roles") o el mensaje de bienvenida.');
  const selectRow = new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('staff_selfrole_add_select').setPlaceholder('Elegí un rol').setMinValues(1).setMaxValues(1));
  const backRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('staff_edit_cancel').setLabel('Volver').setEmoji('↩️').setStyle(ButtonStyle.Secondary));
  return { embeds: [embed], components: [selectRow, backRow] };
}

// Mismo criterio que el menú real de "Mis roles" (selfRoles.js): nunca ofrece los IDs
// crudos de guild_config tal cual — revalida contra el servidor real (roles borrados,
// que se volvieron peligrosos, o que quedaron por encima del bot) antes de mostrar la
// lista para quitar.
async function buildSelfRoleRemoveView(guild, cfg) {
  const liveRoles = await resolveLiveSelfRoles(guild, cfg);
  if (liveRoles.length === 0) {
    const embed = baseEmbed('roles').setDescription('Ya no queda ningún rol autoasignable válido para quitar (puede que se hayan borrado o hayan dejado de ser seguros).');
    const backRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('staff_edit_cancel').setLabel('Volver').setEmoji('↩️').setStyle(ButtonStyle.Secondary));
    return { embeds: [embed], components: [backRow] };
  }
  const embed = baseEmbed('roles').setDescription('Elegí cuál rol autoasignable sacar de la lista. Quienes ya lo tengan lo conservan.');
  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('staff_selfrole_remove_select')
      .setPlaceholder('Elegí un rol para quitar')
      .addOptions(liveRoles.map((r) => new StringSelectMenuOptionBuilder().setLabel(r.name.slice(0, 100)).setValue(r.id))),
  );
  const backRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('staff_edit_cancel').setLabel('Volver').setEmoji('↩️').setStyle(ButtonStyle.Secondary));
  return { embeds: [embed], components: [selectRow, backRow] };
}

function buildDigestScreen(cfg, interaction) {
  const canEdit = isOwnerOrAdmin(interaction);
  const lastSent = cfg.weekly_digest_last_sent_at ? `<t:${Math.floor(cfg.weekly_digest_last_sent_at / 1000)}:R>` : 'Nunca';
  const embed = baseEmbed('digest')
    .setDescription('Se manda automáticamente 7 días después del último envío (o de cuando se activó) — sin día/hora fijos, `guild_config` no guarda eso.')
    .addFields(
      { name: 'Estado', value: cfg.weekly_digest_enabled ? '🟢 Activado' : '🔴 Desactivado', inline: true },
      { name: 'Canal', value: cfg.log_channel_activity_id ? `<#${cfg.log_channel_activity_id}>` : '❌ Sin canal de actividad configurado', inline: true },
      { name: 'Último envío', value: lastSent, inline: true },
    );
  embed.setFooter({ text: canEdit ? BRAND_NAME : '🔒 Activar/desactivar requiere ser dueño o Administrator.' });
  const editRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('staff_digest_toggle')
      .setLabel(cfg.weekly_digest_enabled ? 'Desactivar' : 'Activar')
      .setEmoji(cfg.weekly_digest_enabled ? '🔴' : '🟢')
      .setStyle(cfg.weekly_digest_enabled ? ButtonStyle.Danger : ButtonStyle.Success)
      .setDisabled(!canEdit),
  );
  return { embeds: [embed], components: [editRow, navRow('digest')] };
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

// Misma función que ya usa el autocomplete de /sorteo y /estado — nunca una consulta
// propia. Acotada a 25 filas por su propio `.limit()` (ver giveawaysStore.js): con más
// de 25 sorteos finalizados históricos, "Finalizados" y "Ganadores" reflejan solo los
// 25 más recientes, mismo límite real que ya tenía esa función antes de esta fase.
async function buildSorteosScreen(guildId) {
  const [activos, finalizados] = await Promise.all([
    getGuildGiveawaysForAutocomplete(guildId, false),
    getGuildGiveawaysForAutocomplete(guildId, true),
  ]);
  const embed = baseEmbed('sorteos').addFields(
    { name: 'Sorteos activos', value: `${activos.length}`, inline: true },
    { name: 'Finalizados (últimos 25)', value: `${finalizados.length}`, inline: true },
  );
  if (activos.length > 0) {
    embed.addFields({ name: 'Premios activos ahora', value: activos.map((g) => `• ${g.prize}`).join('\n').slice(0, 1000) });
  }
  embed.setFooter({ text: 'Crear/cancelar/reroll: usá /sorteo mientras tanto — llega a este panel en una fase futura.' });
  return { embeds: [embed], components: [navRow('sorteos')] };
}

async function buildAnunciosScreen(guildId) {
  const templates = await getGuildAnnouncementTemplates(guildId);
  const embed = baseEmbed('anuncios').addFields({
    name: `Plantillas guardadas (${templates.length})`,
    value: templates.length ? templates.map((t) => `• ${t.name}`).join('\n').slice(0, 1000) : '❌ Ninguna guardada todavía',
  });
  embed.setFooter({ text: BRAND_NAME });
  const buttonsRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('staff_anuncio_crear').setLabel('Crear anuncio').setEmoji('📢').setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], components: [buttonsRow, navRow('anuncios')] };
}

// Fase 6 — mismo dato que ya alimenta el dashboard (dashboard/queries.js
// getGuildDailyStats), ahora también leído desde el bot. Suma los últimos 7 días en
// vez de mostrar día por día: el objetivo acá es un pulso rápido de "cómo viene la
// semana", el desglose diario ya vive en el dashboard.
async function buildEstadisticasScreen(guildId) {
  const days = await getGuildDailyStats(guildId, 7);
  const totals = days.reduce(
    (acc, d) => ({
      messages: acc.messages + d.messagesSent,
      commands: acc.commands + d.commandsExecuted,
      newMembers: acc.newMembers + d.newMembers,
      moneyCreated: acc.moneyCreated + d.moneyCreated,
      moneyDestroyed: acc.moneyDestroyed + d.moneyDestroyed,
      xp: acc.xp + d.xpDistributed,
    }),
    { messages: 0, commands: 0, newMembers: 0, moneyCreated: 0, moneyDestroyed: 0, xp: 0 },
  );
  const embed = baseEmbed('estadisticas')
    .setDescription('Últimos 7 días.')
    .addFields(
      { name: 'Mensajes', value: `${totals.messages.toLocaleString('es-AR')}`, inline: true },
      { name: 'Comandos', value: `${totals.commands.toLocaleString('es-AR')}`, inline: true },
      { name: 'Miembros nuevos', value: `${totals.newMembers.toLocaleString('es-AR')}`, inline: true },
      { name: 'Coins creadas', value: `+${totals.moneyCreated.toLocaleString('es-AR')}`, inline: true },
      { name: 'Coins destruidas', value: `-${totals.moneyDestroyed.toLocaleString('es-AR')}`, inline: true },
      { name: 'XP distribuida', value: `${totals.xp.toLocaleString('es-AR')}`, inline: true },
    );
  embed.setFooter({ text: 'Desglose día por día: dashboard web. Acá solo el total de la semana.' });
  return { embeds: [embed], components: [navRow('estadisticas')] };
}

async function buildScreen(screen, interaction) {
  if (screen === 'home') return buildHomeScreen(interaction);
  if (screen === 'config') return buildConfigScreen();
  if (screen === 'sistema') return buildSistemaScreen(interaction);
  if (screen === 'economia') return buildEconomiaScreen(interaction.guildId); // no depende de guild_config — sin toggle propio
  if (screen === 'sorteos') return buildSorteosScreen(interaction.guildId);
  if (screen === 'anuncios') return buildAnunciosScreen(interaction.guildId);
  if (screen === 'estadisticas') return buildEstadisticasScreen(interaction.guildId);
  if (PLACEHOLDER_SCREENS.has(screen)) return buildPlaceholderScreen(screen);

  const cfg = await getGuildConfig(interaction.guildId);
  if (screen === 'moderacion') return buildModeracionScreen(cfg, interaction);
  if (screen === 'xp') return buildXpScreen(cfg, interaction);
  if (screen === 'roles') return buildRolesScreen(cfg, interaction);
  if (screen === 'digest') return buildDigestScreen(cfg, interaction);
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

// Vuelve de una sub-vista transitoria (edición o info) a la pantalla REAL que estaba
// en el tope del stack — nunca la sub-vista misma lo empujó, así que "volver" acá es
// simplemente re-renderizar el stack tal cual está. Genérico a propósito: lo usan
// tanto los 2 flujos de edición de Moderación (Fase 2) como las 3 vistas de
// información de Economía (Fase 3), y cualquier sub-vista futura del mismo tipo.
registerButtonPrefix('staff_edit_cancel', async (i) => {
  const key = sessionKey(i.guildId, i.user.id);
  const stack = getStack(key) || ['home'];
  await i.update(await buildScreen(stack[stack.length - 1], i));
});

registerButtonPrefix('staff_econ_ver', async (i) => {
  await i.update(await buildEconomiaVerView(i.guildId));
});

registerButtonPrefix('staff_econ_staff', async (i) => {
  await i.update(buildEconomiaStaffView());
});

registerButtonPrefix('staff_econ_limites', async (i) => {
  await i.update(buildEconomiaLimitesView());
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

// ---------- Fase 4: edición de XP y Roles ----------

// Toggle simple de 2 valores — a diferencia del canal/rol de Moderación, no hace
// falta ningún select: un click alterna directo entre los dos únicos modos válidos
// (mismo par que ofrece /config modo-roles-nivel).
registerButtonPrefix('staff_xp_toggle_mode', async (i) => {
  if (!isOwnerOrAdmin(i)) {
    return i.reply({ content: '❌ Solo el dueño del servidor o un administrador puede cambiar esto.', flags: MessageFlags.Ephemeral });
  }
  const cfg = await getGuildConfig(i.guildId);
  const newMode = cfg.level_roles_mode === 'replace' ? 'cumulative' : 'replace';
  await setGuildConfig(i.guildId, { level_roles_mode: newMode });

  const freshCfg = await getGuildConfig(i.guildId);
  await i.update(buildXpScreen(freshCfg, i));
  await i.followUp({ content: `✅ Modo de roles de nivel: **${levelRolesModeLabel(newMode)}**.`, flags: MessageFlags.Ephemeral });
  await logConfigChange(i, `✨ Modo de roles de nivel → ${levelRolesModeLabel(newMode)} (desde /staff)`);
});

registerButtonPrefix('staff_selfrole_add', async (i) => {
  if (!isOwnerOrAdmin(i)) {
    return i.reply({ content: '❌ Solo el dueño del servidor o un administrador puede cambiar esto.', flags: MessageFlags.Ephemeral });
  }
  await i.update(buildSelfRoleAddView());
});

registerButtonPrefix('staff_selfrole_remove', async (i) => {
  if (!isOwnerOrAdmin(i)) {
    return i.reply({ content: '❌ Solo el dueño del servidor o un administrador puede cambiar esto.', flags: MessageFlags.Ephemeral });
  }
  const cfg = await getGuildConfig(i.guildId);
  await i.update(await buildSelfRoleRemoveView(i.guild, cfg));
});

// Mismas 4 validaciones que /config rol-autoasignable-agregar, en el mismo orden —
// nunca una versión más laxa solo porque se entra desde el panel.
registerSelectPrefix('staff_selfrole_add_select', async (i) => {
  if (!isOwnerOrAdmin(i)) {
    return i.reply({ content: '❌ Solo el dueño del servidor o un administrador puede cambiar esto.', flags: MessageFlags.Ephemeral });
  }
  const role = i.roles.first();

  const dangerousPermission = getDangerousRolePermission(role);
  if (dangerousPermission) {
    return i.reply({
      content: `❌ ${role} tiene el permiso **${dangerousPermission}**, así que no se puede ofrecer como autoasignable — cualquier miembro podría dárselo a sí mismo. Elegí (o creá) un rol sin privilegios administrativos.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const me = i.guild.members.me;
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles) || me.roles.highest.position <= role.position) {
    return i.reply({
      content: `❌ NEXO no podría asignar ${role} — está en una posición igual o superior al rol más alto del bot. Subí el rol de NEXO por encima en *Ajustes del servidor → Roles*, o elegí otro rol.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const cfg = await getGuildConfig(i.guildId);
  const current = cfg.selfassignable_roles || [];
  if (current.includes(role.id)) {
    return i.reply({ content: `ℹ️ ${role} ya está en la lista de autoasignables.`, flags: MessageFlags.Ephemeral });
  }
  if (current.length >= 25) {
    return i.reply({
      content: '❌ Ya hay 25 roles autoasignables — es el máximo que entra en un solo menú. Sacá alguno antes de agregar otro.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await setGuildConfig(i.guildId, { selfassignable_roles: [...current, role.id] });

  const freshCfg = await getGuildConfig(i.guildId);
  await i.update(buildRolesScreen(freshCfg, i));
  await i.followUp({ content: `✅ ${role} agregado a los roles autoasignables.`, flags: MessageFlags.Ephemeral });
  await logConfigChange(i, `🎭 Rol autoasignable agregado → ${role} (desde /staff)`);
});

registerSelectPrefix('staff_selfrole_remove_select', async (i) => {
  if (!isOwnerOrAdmin(i)) {
    return i.reply({ content: '❌ Solo el dueño del servidor o un administrador puede cambiar esto.', flags: MessageFlags.Ephemeral });
  }
  const roleId = i.values[0];
  const cfg = await getGuildConfig(i.guildId);
  const current = cfg.selfassignable_roles || [];
  await setGuildConfig(i.guildId, { selfassignable_roles: current.filter((id) => id !== roleId) });

  const freshCfg = await getGuildConfig(i.guildId);
  await i.update(buildRolesScreen(freshCfg, i));
  await i.followUp({ content: `✅ <@&${roleId}> sacado de los roles autoasignables. Quienes ya lo tenían lo conservan.`, flags: MessageFlags.Ephemeral });
  await logConfigChange(i, `🎭 Rol autoasignable quitado → <@&${roleId}> (desde /staff)`);
});

// ---------- Fase 5: Anuncios ----------
// Lanza el flujo REAL de /anuncio (startBuilder, ya reusado por el propio comando) en
// vez de reimplementar el builder acá — startBuilder hace su propio interaction.reply(),
// así que esta interacción de botón nunca se toca con i.update()/i.reply() propio.
registerButtonPrefix('staff_anuncio_crear', async (i) => {
  await startAnuncioBuilder(i);
});

// ---------- Fase 6: Digest semanal ----------
// Misma semántica exacta que /config digest-semanal: activar siembra
// weekly_digest_last_sent_at = ahora (para que el primer envío real, 7 días después,
// refleje una semana completa en vez de actividad de antes de activarlo); desactivar
// lo deja en null. Nunca un toggle "ingenuo" que solo tocara el booleano.
registerButtonPrefix('staff_digest_toggle', async (i) => {
  if (!isOwnerOrAdmin(i)) {
    return i.reply({ content: '❌ Solo el dueño del servidor o un administrador puede cambiar esto.', flags: MessageFlags.Ephemeral });
  }
  const cfg = await getGuildConfig(i.guildId);
  const nuevoEstado = !cfg.weekly_digest_enabled;
  await setGuildConfig(i.guildId, { weekly_digest_enabled: nuevoEstado, weekly_digest_last_sent_at: nuevoEstado ? Date.now() : null });

  const freshCfg = await getGuildConfig(i.guildId);
  await i.update(buildDigestScreen(freshCfg, i));
  await i.followUp({
    content: nuevoEstado ? '✅ Digest semanal activado — el primer resumen llega en 7 días al canal de logs de actividad.' : '✅ Digest semanal desactivado.',
    flags: MessageFlags.Ephemeral,
  });
  await logConfigChange(i, `📊 Digest semanal → ${nuevoEstado ? 'activado' : 'desactivado'} (desde /staff)`);
});
