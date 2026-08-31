import { PermissionFlagsBits } from 'discord.js';
import { getGuildConfig } from './guildConfigStore.js';

// QUÉ CAMBIÓ: se extrajo el núcleo booleano a isStaffFromRoleIds(), reusado por
// isStaff() acá, por messageCreate.js (chequeo de staff del anti-spam) y por
// dashboard/permissions.js (que antes tenía su propia copia idéntica adaptada al array
// plano de la REST API, en vez de a un member.roles.cache de discord.js).
// MOTIVO: auditoría 2026-08-29 (Diagnóstico Nexo, Parte 13/22) — "reimplementación
// duplicada... riesgo real de divergencia: si isStaff() cambia de lógica, la copia no
// se actualiza sola". roleIds acepta cualquier array plano de IDs — funciona igual para
// [...member.roles.cache.keys()] (bot) que para el array crudo que ya devuelve la REST
// API de Discord (dashboard), sin que ninguno de los dos lados conozca el shape del otro.
// VERIFICACIÓN: /warn, /ban, etc. (que usan isStaff) siguen gateando igual que antes;
// el dashboard sigue mostrando/ocultando servidores igual que antes.
export function isStaffFromRoleIds(cfg, roleIds) {
  if (!cfg || !roleIds) return false;
  return Boolean(
    (cfg.admin_role_id && roleIds.includes(cfg.admin_role_id)) ||
      (cfg.moderator_role_id && roleIds.includes(cfg.moderator_role_id)),
  );
}

// Chequeo de admin/staff compartido por todos los comandos de moderación.
// A diferencia de gNoX (roles fijos en .env), acá cada servidor configura los
// suyos con /setup y quedan en guild_config — por eso esto es async.
export async function isStaff(interaction) {
  const cfg = await getGuildConfig(interaction.guildId);
  return isStaffFromRoleIds(cfg, [...interaction.member.roles.cache.keys()]);
}

// "¿Hay algún rol de staff configurado en absoluto?" — distinto de isStaff()
// (que chequea si ESTE usuario tiene uno de esos roles). Sirve para diferenciar
// "todavía no corriste /setup" de "no tenés el rol".
export async function isStaffConfigured(guildId) {
  const cfg = await getGuildConfig(guildId);
  return Boolean(cfg.admin_role_id || cfg.moderator_role_id);
}

// Valida que un moderador pueda aplicar una acción sobre "targetMember".
// Devuelve null si está todo bien, o un mensaje de error listo para responder si no.
// Bloquea: actuar sobre uno mismo, sobre el bot, o sobre alguien con rango igual/mayor
// (salvo que quien ejecuta el comando sea el dueño del servidor).
export function getModerationBlockReason(interaction, targetMember) {
  if (!targetMember) return null;

  if (targetMember.id === interaction.user.id) {
    return '❌ No podés aplicar esta acción sobre vos mismo.';
  }
  if (targetMember.id === interaction.client.user.id) {
    return '❌ No podés aplicar esta acción sobre el bot.';
  }

  const isOwner = interaction.guild.ownerId === interaction.user.id;
  if (!isOwner && targetMember.roles.highest.position >= interaction.member.roles.highest.position) {
    return '❌ No podés aplicar esta acción sobre alguien con tu mismo rango o superior.';
  }

  return null;
}

// Permisos peligrosos si terminan en un rol que el bot asigna SOLO (sin que un staff
// revise el caso puntual): el rol automático de /config rol-automatico (se le pone a
// CADA miembro nuevo que se une) y el rol de castigo de /config rol-castigo (punish.js
// se lo agrega a un usuario sancionado). En los dos casos, elegir por error un rol que
// ya tiene privilegios reales es una escalada de privilegios accidental — no hace falta
// que sea intencional, alcanza con clickear el rol equivocado en el selector.
//
// No es "cualquier permiso especial": se listan específicamente los que dan control real
// del servidor o de otros usuarios — administración total, gestión de servidor/roles/
// canales/webhooks, y poderes de moderación (kick/ban/timeout/manage messages/apodos) —
// más @everyone (spam masivo). Se dejan afuera permisos "molestos pero no peligrosos"
// para este caso (ManageEmojisAndStickers, ManageEvents, ManageThreads, ViewAuditLog,
// CreateInstantInvite, etc.) para no bloquear roles normales de comunidad sin necesidad.
const DANGEROUS_ROLE_PERMISSIONS = [
  [PermissionFlagsBits.Administrator, 'Administrador'],
  [PermissionFlagsBits.ManageGuild, 'Gestionar servidor'],
  [PermissionFlagsBits.ManageRoles, 'Gestionar roles'],
  [PermissionFlagsBits.ManageChannels, 'Gestionar canales'],
  [PermissionFlagsBits.ManageWebhooks, 'Gestionar webhooks'],
  [PermissionFlagsBits.KickMembers, 'Expulsar miembros'],
  [PermissionFlagsBits.BanMembers, 'Banear miembros'],
  [PermissionFlagsBits.ModerateMembers, 'Aplicar timeout (moderar miembros)'],
  [PermissionFlagsBits.ManageMessages, 'Gestionar mensajes'],
  [PermissionFlagsBits.ManageNicknames, 'Gestionar apodos'],
  [PermissionFlagsBits.MentionEveryone, 'Mencionar a @everyone/@here'],
];

// Devuelve null si "role" es seguro para auto-asignar, o la etiqueta en español del
// primer permiso peligroso encontrado (para mostrarlo en el mensaje de error). Puro —
// no toca guild_config ni hace ningún await, mismo criterio que getModerationBlockReason.
export function getDangerousRolePermission(role) {
  if (!role?.permissions) return null;
  for (const [flag, label] of DANGEROUS_ROLE_PERMISSIONS) {
    if (role.permissions.has(flag)) return label;
  }
  return null;
}
