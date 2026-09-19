// Motor de estado derivado para el panel principal de /setup (NEXO Setup Inteligente,
// Bloque 15/16). A propósito NO hay ninguna tabla de "progreso del wizard": cada sección
// se calcula en vivo contra guild_config + el estado real del guild en Discord, así que
// reabrir /setup "recuerda dónde quedaste" sin necesitar memoria ni una fila nueva —
// simplemente vuelve a mirar la realidad. Puro: sin efectos secundarios, sin tocar
// Discord más allá de leer lo que discord.js ya tiene cacheado (guild.members.me).
//
// Decisiones de producto confirmadas explícitamente por el usuario antes de escribir
// esto (no inventadas): Casino siempre 🟢 (no tiene ninguna configuración real que
// gatear — casinoHelpers.js es 100% constantes globales); "economía lista" es una
// advertencia 🟡 (nunca bloqueo 🔴) cuando el servidor usa el catálogo de ejemplo en vez
// de ítems propios, porque /shop funciona igual en los dos casos.
import { getMissingBotPermissions } from './botPermissions.js';
import { hasCustomShopItems } from './shopStore.js';
import { isCustomWelcomeConfigured } from './welcomeEmbed.js';

export const STATUS = { OK: 'ok', WARN: 'warn', ERROR: 'error' };

export const STATUS_EMOJI = { [STATUS.OK]: '🟢', [STATUS.WARN]: '🟡', [STATUS.ERROR]: '🔴' };

function rolesStatus(cfg) {
  if (cfg.moderator_role_id) {
    return { status: STATUS.OK, detail: 'Rol de staff configurado.' };
  }
  return { status: STATUS.ERROR, detail: 'Todavía no hay ningún rol de staff — corré la configuración de roles.' };
}

function moderationStatus(cfg) {
  if (cfg.features?.moderacion) {
    return { status: STATUS.OK, detail: 'Módulo de moderación activado, con canales de log.' };
  }
  return { status: STATUS.WARN, detail: 'Todavía no activaste el módulo de moderación.' };
}

function welcomeStatus(cfg) {
  if (!cfg.welcome_channel_id) {
    return { status: STATUS.ERROR, detail: 'No hay ningún canal de bienvenida configurado todavía.' };
  }
  if (isCustomWelcomeConfigured(cfg)) {
    return { status: STATUS.OK, detail: 'Canal de bienvenida configurado, con texto personalizado.' };
  }
  return { status: STATUS.WARN, detail: 'Canal de bienvenida configurado, pero usando el texto de ejemplo — personalizalo si querés.' };
}

async function economyStatus(guildId) {
  const custom = await hasCustomShopItems(guildId);
  if (custom) return { status: STATUS.OK, detail: 'La tienda tiene ítems propios de este servidor.' };
  return {
    status: STATUS.WARN,
    detail: 'La tienda todavía usa el catálogo de ejemplo genérico — la economía funciona igual, pero es una buena idea personalizarla.',
  };
}

// El casino (coinflip/dado/slots/ruleta) es 100% constantes globales — confirmado
// leyendo casinoHelpers.js y las columnas reales de guild_config: no existe NINGUNA
// columna ni tabla que lo gatee. Mostrarlo como "bloqueado" sería inventar un requisito
// que no existe — se muestra siempre listo, con la aclaración de por qué.
function casinoStatus() {
  return {
    status: STATUS.OK,
    detail: 'El casino no depende de ninguna configuración por-servidor — funciona igual en cualquier NEXO, sin pasos previos.',
  };
}

function botPermissionsStatus(guild) {
  const missing = getMissingBotPermissions(guild);
  if (missing.length === 0) {
    return { status: STATUS.OK, detail: 'NEXO tiene todos los permisos esenciales.', missing: [] };
  }
  return {
    status: STATUS.ERROR,
    detail: `Faltan ${missing.length} permiso(s) esenciales — corregilo en Ajustes del servidor → Roles.`,
    missing,
  };
}

// `guild` es un objeto Guild real de discord.js (o un mock equivalente en tests) — se
// usa `guild.id` para las consultas a Supabase y `guild` completo para leer permisos del
// bot desde el cache ya cargado (sin ningún fetch extra).
export async function getSetupStatus(guild, cfg) {
  const [economia] = await Promise.all([economyStatus(guild.id)]);

  return {
    roles: rolesStatus(cfg),
    moderacion: moderationStatus(cfg),
    bienvenida: welcomeStatus(cfg),
    economia,
    casino: casinoStatus(),
    permisosBot: botPermissionsStatus(guild),
  };
}

// Cantidad de secciones que requieren atención (🟡 o 🔴) — usado en el resumen final
// ("2 cosas requieren atención", Bloque 15).
export function countPendingSections(sections) {
  return Object.values(sections).filter((s) => s.status !== STATUS.OK).length;
}
