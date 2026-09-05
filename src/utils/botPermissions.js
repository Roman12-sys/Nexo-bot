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
import { PermissionFlagsBits } from 'discord.js';

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

// Bitfield (como string decimal, formato que espera el query param `permissions` de
// Discord) para pre-tildar estos permisos en la pantalla de consentimiento al invitar el
// bot — Discord igual deja desmarcar cualquiera ahí, esto solo mejora el default. Antes
// el link de invite (dashboard/html.js) no llevaba ningún `permissions=`, así que
// Discord no pre-seleccionaba nada.
export function essentialPermissionsBitfield() {
  return ESSENTIAL_BOT_PERMISSIONS.reduce((acc, { flag }) => acc | flag, 0n).toString();
}
