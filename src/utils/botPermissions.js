// Permisos esenciales del bot — Fase 4C-1 (auditoría de producto: "un admin puede sacar
// un permiso durante la instalación y después interpretar que NEXO está roto", sin
// ninguna forma de enterarse). No es una lista exhaustiva de los ~40 permisos de la API
// — es exactamente lo que un comando/feature REAL de este repo usa hoy (verificado
// contra el código, no inventado): ManageChannels/ManageRoles los ejerce /setup al crear
// canales/roles; ManageMessages lo usan /clear, /lock, el filtro de sancionados y la
// detección de secretos; KickMembers/BanMembers/ModerateMembers son /kick, /ban+/unban,
// /timeout; MoveMembers lo chequea explícitamente voice.js para las salas de voz
// temporales; AttachFiles lo necesitan la tarjeta de bienvenida y la de nivel (imágenes
// generadas con @napi-rs/canvas). ViewChannel/SendMessages/EmbedLinks/ReadMessageHistory
// son la base de cualquier respuesta o log.
//
// Deliberadamente AFUERA (no rompen nada si faltan, ya degradan solo): ViewAuditLog
// (findExecutor en auditLog.js ya devuelve null sin tirar si falta — solo empeora la
// atribución de "quién hizo esto" en los logs) y MentionEveryone (/anuncio simplemente
// no llega a notificar un @everyone, el mensaje se manda igual).
import { PermissionFlagsBits, ChannelType, OverwriteType } from 'discord.js';

export const ESSENTIAL_BOT_PERMISSIONS = [
  { flag: PermissionFlagsBits.ViewChannel, label: 'Ver canales', feature: 'Todo el bot' },
  { flag: PermissionFlagsBits.SendMessages, label: 'Enviar mensajes', feature: 'Todo el bot' },
  { flag: PermissionFlagsBits.EmbedLinks, label: 'Insertar enlaces (embeds)', feature: 'Casi todas las respuestas del bot' },
  { flag: PermissionFlagsBits.ReadMessageHistory, label: 'Ver historial de mensajes', feature: '/encuesta cerrar, logs de mensajes editados/borrados' },
  { flag: PermissionFlagsBits.ManageMessages, label: 'Gestionar mensajes', feature: '/clear, /lock, filtro de sancionados, detección de secretos' },
  { flag: PermissionFlagsBits.ManageChannels, label: 'Gestionar canales', feature: '/setup, /lock, /unlock, salas de voz temporales' },
  { flag: PermissionFlagsBits.ManageRoles, label: 'Gestionar roles', feature: '/setup, /punish, roles automáticos y de nivel' },
  { flag: PermissionFlagsBits.KickMembers, label: 'Expulsar miembros', feature: '/kick' },
  { flag: PermissionFlagsBits.BanMembers, label: 'Banear miembros', feature: '/ban, /unban' },
  { flag: PermissionFlagsBits.ModerateMembers, label: 'Aplicar timeout', feature: '/timeout' },
  { flag: PermissionFlagsBits.MoveMembers, label: 'Mover miembros de voz', feature: 'Salas de voz temporales' },
  { flag: PermissionFlagsBits.AttachFiles, label: 'Adjuntar archivos', feature: 'Tarjeta de bienvenida y de nivel' },
];

// Devuelve solo las entradas que al bot le faltan en ESTE server (permiso a nivel de
// servidor vía el rol más alto del bot — discord.js ya lo calcula en .permissions).
// [] si guild.members.me no está disponible (nunca debería tirar por esto) o no falta
// nada. Puro — no hace ningún await, mismo criterio que getModerationBlockReason.
export function getMissingBotPermissions(guild) {
  const me = guild?.members?.me;
  if (!me) return [];
  return ESSENTIAL_BOT_PERMISSIONS.filter(({ flag }) => !me.permissions.has(flag));
}

// Canales de texto que el bot puede VER (2026-09-27). getMissingBotPermissions mira los
// permisos del bot en el servidor ("¿tiene Ver canales?"), pero los permisos por canal
// pueden negárselo en todos lados: pasó en Cloud6, donde @everyone no ve nada y solo el
// rol "Cloud6" ve los canales — NEXO tenía "Ver canales" en el servidor y 0 de 16
// canales visibles, y /estado decía "✅ Todo OK". Sin ver un canal, ahí no hay XP por
// mensajes, anti-spam, detección de claves ni logs de mensajes.
// Lee solo el cache de discord.js (sin fetch). null si no se puede calcular.
//
// Con `cfg`, no cuenta los canales de NEXO (logs, bienvenida, confesiones y todo lo que
// está en su categoría): esos los ve siempre porque los crea él, y en Cloud6 después de
// /setup el conteo habría dicho "ve 3 de 19" cuando no veía ni un canal de la comunidad.
const TEXT_CHANNEL_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

function nexoChannelIds(cfg) {
  if (!cfg) return new Set();
  return new Set(
    [cfg.log_channel_moderation_id, cfg.log_channel_activity_id, cfg.log_channel_economy_id, cfg.welcome_channel_id, cfg.confession_channel_id].filter(Boolean),
  );
}

export function getBotChannelVisibility(guild, cfg = null) {
  const me = guild?.members?.me;
  const channels = guild?.channels?.cache;
  if (!me || typeof channels?.values !== 'function') return null;
  const ownIds = nexoChannelIds(cfg);
  const ownCategoryId = cfg?.setup_category_id || null;
  let total = 0;
  let visible = 0;
  for (const channel of channels.values()) {
    if (!TEXT_CHANNEL_TYPES.has(channel.type)) continue;
    if (ownIds.has(channel.id) || (ownCategoryId && channel.parentId === ownCategoryId)) continue;
    total += 1;
    if (channel.permissionsFor?.(me)?.has(PermissionFlagsBits.ViewChannel)) visible += 1;
  }
  return { visible, total };
}

// Texto para mostrarle al staff (/estado, /staff, /setup). null si no hay nada que decir.
// No ver ALGUNOS canales es normal (canales privados de staff); no ver NINGUNO no lo es.
export function describeChannelVisibility(visibility) {
  if (!visibility || visibility.total === 0) return null;
  const { visible, total } = visibility;
  if (visible === 0) {
    const which = total === 1 ? 'el único canal de texto' : `ninguno de los ${total} canales de texto`;
    return `🔴 NEXO no puede ver ${which}: no modera, no da XP por mensajes y no registra mensajes. Dale a NEXO el rol que ve los canales, o sumá su rol en los permisos de cada canal.`;
  }
  if (visible < total) return `👁️ NEXO ve ${visible} de ${total} canales de texto — en los demás no modera ni da XP (normal si son privados del staff).`;
  return total === 1 ? '👁️ NEXO ve el único canal de texto.' : `👁️ NEXO ve los ${total} canales de texto.`;
}

// Overwrite para que NEXO no quede afuera de un canal que él mismo crea o corrige
// (2026-09-27). Los permisos de un canal también se le aplican al bot: si @everyone
// tiene "Ver canal" negado y el bot no tiene "Administrador", pierde acceso a su propio
// canal de logs, o a la sala temporal que acaba de crear (y entonces no puede mover al
// usuario ni borrarla). En los servidores donde NEXO anda hoy nunca se notó porque el
// bot tiene "Administrador", que saltea todos los permisos de canal.
// Solo incluye permisos que el bot ya tiene en el servidor (Discord rechaza un overwrite
// que otorgue un permiso que el bot no tiene). null si no hay nada que agregar.
export function buildBotAccessOverwrite(guild, flags) {
  const me = guild?.members?.me;
  if (!me?.id) return null;
  const allow = flags.filter((flag) => me.permissions?.has(flag));
  if (allow.length === 0) return null;
  return { id: me.id, type: OverwriteType.Member, allow };
}

export const BOT_TEXT_CHANNEL_ACCESS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ReadMessageHistory,
];

// Bitfield (como string decimal, formato que espera el query param `permissions` de
// Discord) para pre-tildar estos permisos en la pantalla de consentimiento al invitar el
// bot — Discord igual deja desmarcar cualquiera ahí, esto solo mejora el default. Antes
// el link de invite (dashboard/html.js) no llevaba ningún `permissions=`, así que
// Discord no pre-seleccionaba nada.
export function essentialPermissionsBitfield() {
  return ESSENTIAL_BOT_PERMISSIONS.reduce((acc, { flag }) => acc | flag, 0n).toString();
}
