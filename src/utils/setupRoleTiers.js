// Matriz de roles de staff sugeridos para /setup (NEXO Setup Inteligente, Bloques 1-3).
// Diseño explícito, analizado contra getDangerousRolePermission() (permissions.js) y el
// sistema real de tiers de NEXO — NO copiado de gNoX ni de ningún lado.
//
// DOS COSAS DISTINTAS QUE NUNCA SE MEZCLAN ACÁ (Bloque 3):
// - "Discord Permissions" (ROLE_TIERS[x].permissions): bits NATIVOS que el rol le da al
//   HUMANO dentro del cliente de Discord (expulsar, banear, gestionar canales...),
//   totalmente al margen de qué comandos de NEXO pueda correr.
// - "NEXO Staff Tier": el sistema propio del bot (isStaff/isAdmin, permissions.js) — decide
//   qué SLASH COMMANDS puede correr alguien. Solo 2 columnas existen en guild_config
//   (admin_role_id/moderator_role_id) y NUNCA se amplían acá — crear uno de estos 6 roles
//   NO alcanza para pasar isStaff()/isAdmin(): hace falta un paso APARTE y explícito
//   (wireRoleTiers, más abajo) que asigne 2 de estos roles (o roles ya existentes, sin
//   relación con esta matriz) a esas 2 columnas. El resto (Co-Founder/Coordinador/
//   Ayudante/Staff) son organizativos — NEXO no los vuelve a mirar después de creados.
//
// Nunca se incluye PermissionFlagsBits.Administrator en ningún nivel — bypassea TODOS los
// permisos de Discord de una sola vez, exactamente lo que este diseño evita (Bloque 3).
// Varios de los bits usados acá SÍ están en DANGEROUS_ROLE_PERMISSIONS de permissions.js
// (Kick/Ban/ModerateMembers/ManageMessages/ManageNicknames) — esa lista protege contra
// asignación AUTOMÁTICA y silenciosa (rol de bienvenida/castigo); un rol de staff que el
// admin elige crear a mano, viendo la vista previa completa antes de confirmar, es un
// contexto de riesgo distinto y estos permisos son exactamente lo que un rol de ese nivel
// necesita para operar. getDangerousRolePermission() nunca se aplica a los roles de esta
// matriz (mismo criterio que el rol "Staff" que /setup ya crea hoy, sin rejectDangerous).
import { PermissionFlagsBits } from 'discord.js';
import { LOG_COLOR, BRAND_COLOR, GOLD_COLOR, INDIGO_COLOR, SKY_COLOR, NEUTRAL_COLOR } from './embeds.js';

const {
  ManageGuild,
  ManageRoles,
  ManageChannels,
  ManageWebhooks,
  ManageNicknames,
  ManageMessages,
  ManageThreads,
  ManageEmojisAndStickers,
  ManageEvents,
  KickMembers,
  BanMembers,
  ModerateMembers,
  MentionEveryone,
  ViewAuditLog,
  CreateInstantInvite,
  MoveMembers,
  MuteMembers,
  DeafenMembers,
  PrioritySpeaker,
} = PermissionFlagsBits;

// Orden = jerarquía deseada (administrador más alto, staff más bajo). El wizard crea los
// roles elegidos y después los reposiciona en este mismo orden (best-effort, ver setup.js).
export const ROLE_TIER_ORDER = ['administrador', 'cofounder', 'coordinador', 'moderador', 'ayudante', 'staff'];

export const ROLE_TIERS = {
  administrador: {
    key: 'administrador',
    label: 'Administrador',
    emoji: '🛡️',
    defaultName: 'Administrador',
    defaultColor: LOG_COLOR,
    summary: 'Control operativo amplio del servidor (sin el permiso nativo "Administrador" de Discord).',
    permissions: [
      ManageGuild, ManageRoles, ManageChannels, ManageWebhooks, ManageNicknames, ManageMessages, ManageThreads,
      ManageEmojisAndStickers, ManageEvents, KickMembers, BanMembers, ModerateMembers, MentionEveryone,
      ViewAuditLog, CreateInstantInvite, MoveMembers, MuteMembers, DeafenMembers, PrioritySpeaker,
    ],
    tierHint: 'admin', // sugerido para guild_config.admin_role_id
  },
  cofounder: {
    key: 'cofounder',
    label: 'Co-Founder',
    emoji: '💜',
    defaultName: 'Co-Founder',
    defaultColor: BRAND_COLOR,
    summary: 'Permisos operativos elevados (roles, canales, moderación completa) sin ajustes de servidor.',
    permissions: [
      ManageRoles, ManageChannels, ManageNicknames, ManageMessages, ManageThreads, ManageEmojisAndStickers,
      ManageEvents, KickMembers, BanMembers, ModerateMembers, MentionEveryone, CreateInstantInvite,
      MoveMembers, MuteMembers, DeafenMembers,
    ],
    // null, no 'admin' (2026-09-24): sin ManageGuild ("sin ajustes de servidor", a
    // propósito) no ve en el menú de "/" ningún comando de tier Administrador
    // (/economia-staff, /xp, /shop-admin, /say piden ManageGuild). Sugerirlo para
    // admin_role_id dejaba un "admin" que no encontraba sus propios comandos.
    tierHint: null,
  },
  coordinador: {
    key: 'coordinador',
    label: 'Coordinador',
    emoji: '🧭',
    defaultName: 'Coordinador',
    defaultColor: GOLD_COLOR,
    summary: 'Moderación + gestión operativa del día a día (eventos, hilos, apodos).',
    permissions: [
      KickMembers, ModerateMembers, ManageMessages, ManageThreads, ManageNicknames, ManageEvents,
      CreateInstantInvite, MoveMembers, MuteMembers, DeafenMembers,
    ],
    tierHint: 'moderator', // sugerido para guild_config.moderator_role_id
  },
  moderador: {
    key: 'moderador',
    label: 'Moderador',
    emoji: '🔨',
    defaultName: 'Moderador',
    defaultColor: INDIGO_COLOR,
    summary: 'Moderación de chat y voz: expulsar, timeout, gestionar mensajes e hilos.',
    permissions: [KickMembers, ModerateMembers, ManageMessages, ManageThreads, CreateInstantInvite, MoveMembers, MuteMembers, DeafenMembers],
    tierHint: 'moderator',
  },
  ayudante: {
    key: 'ayudante',
    label: 'Ayudante',
    emoji: '🤝',
    defaultName: 'Ayudante',
    defaultColor: SKY_COLOR,
    summary: 'Funciones auxiliares: gestionar mensajes e hilos, sin expulsar ni banear.',
    permissions: [ManageMessages, ManageThreads, CreateInstantInvite],
    tierHint: null,
  },
  staff: {
    key: 'staff',
    label: 'Staff',
    emoji: '⭐',
    defaultName: 'Staff',
    defaultColor: NEUTRAL_COLOR,
    summary: 'Rol básico de staff — casi sin permisos nativos, pensado como marca visual.',
    permissions: [CreateInstantInvite, ManageThreads],
    tierHint: null,
  },
};

// Preseleccionados al abrir el wizard — un punto de partida razonable (los 4 niveles de
// arriba), nunca "todos" ni "ninguno": el admin ajusta desde acá (Bloque 1, "no asumir
// que todos deben existir").
export const DEFAULT_SELECTED_TIERS = ['administrador', 'cofounder', 'coordinador', 'moderador'];

// Paleta editable del Design System (embeds.js) — usada por el editor de color del
// wizard. Nunca se inventa un color fuera de esta lista con nombre.
export const EDITABLE_COLOR_PALETTE = [
  { name: 'Rojo (alerta)', hex: LOG_COLOR },
  { name: 'Violeta (marca)', hex: BRAND_COLOR },
  { name: 'Oro (progresión)', hex: GOLD_COLOR },
  { name: 'Índigo (moderación)', hex: INDIGO_COLOR },
  { name: 'Cielo (comunicación)', hex: SKY_COLOR },
  { name: 'Neutro', hex: NEUTRAL_COLOR },
];

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

export function isValidHexColor(value) {
  return typeof value === 'string' && HEX_RE.test(value.trim());
}

export function normalizeHexColor(value) {
  const trimmed = value.trim();
  return trimmed.startsWith('#') ? trimmed.toUpperCase() : `#${trimmed.toUpperCase()}`;
}

// Resume la lista de bits en texto corto para el embed de preview — nunca un dump crudo
// del bitfield. Agrupa por lo que un admin reconoce, no por el nombre técnico de Discord.
const PERMISSION_LABELS = new Map([
  [ManageGuild, 'Gestionar servidor'],
  [ManageRoles, 'Gestionar roles'],
  [ManageChannels, 'Gestionar canales'],
  [ManageWebhooks, 'Gestionar webhooks'],
  [ManageNicknames, 'Gestionar apodos'],
  [ManageMessages, 'Gestionar mensajes'],
  [ManageThreads, 'Gestionar hilos'],
  [ManageEmojisAndStickers, 'Gestionar emojis/stickers'],
  [ManageEvents, 'Gestionar eventos'],
  [KickMembers, 'Expulsar miembros'],
  [BanMembers, 'Banear miembros'],
  [ModerateMembers, 'Aplicar timeout'],
  [MentionEveryone, 'Mencionar @everyone'],
  [ViewAuditLog, 'Ver registro de auditoría'],
  [CreateInstantInvite, 'Crear invitaciones'],
  [MoveMembers, 'Mover miembros de voz'],
  [MuteMembers, 'Silenciar en voz'],
  [DeafenMembers, 'Ensordecer en voz'],
  [PrioritySpeaker, 'Prioridad de voz'],
]);

// Agrupados por tema (feedback en vivo probando el wizard: un solo párrafo de ~19
// permisos separados por coma era ilegible, sobre todo en Administrador/Co-Founder).
// Mismo criterio que ya usa /help para agrupar los 20 comandos de "Acción" en 3
// sub-bloques por tema en vez de una lista plana.
const PERMISSION_GROUPS = [
  { label: 'Moderación', flags: [KickMembers, BanMembers, ModerateMembers, ManageMessages] },
  {
    label: 'Gestión',
    flags: [ManageGuild, ManageRoles, ManageChannels, ManageWebhooks, ManageNicknames, ManageThreads, ManageEmojisAndStickers, ManageEvents],
  },
  { label: 'Voz', flags: [MoveMembers, MuteMembers, DeafenMembers, PrioritySpeaker] },
  { label: 'Otros', flags: [MentionEveryone, ViewAuditLog, CreateInstantInvite] },
];

// Devuelve varias líneas, una por grupo (con al menos 1 permiso del tier), con el
// nombre del grupo en negrita — nunca un párrafo único. Grupos sin ningún permiso de
// este tier ni aparecen (ej. Ayudante no tiene nada de "Voz").
export function describeTierPermissions(tierKey) {
  const tier = ROLE_TIERS[tierKey];
  if (!tier) return '';
  const tierFlags = new Set(tier.permissions);
  const lines = [];
  for (const group of PERMISSION_GROUPS) {
    const matching = group.flags.filter((flag) => tierFlags.has(flag));
    if (matching.length === 0) continue;
    lines.push(`**${group.label}:** ${matching.map((flag) => PERMISSION_LABELS.get(flag) || 'Permiso').join(', ')}`);
  }
  return lines.join('\n');
}
