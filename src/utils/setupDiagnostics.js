// Diagnóstico de canales/permisos de /setup (NEXO Setup Inteligente, Bloques 6-9).
//
// Alcance deliberadamente acotado en dos niveles de confianza distintos — no se puede
// "inventar" qué configuración es correcta para un canal que NEXO no creó:
//
// 1. CANALES QUE NEXO GESTIONA (los 3 logs + bienvenida + confesiones, creados por
//    /setup): acá SÍ se conoce el estado correcto (el mismo que /setup ya aplica al
//    crearlos), así que el diagnóstico es preciso y la corrección (Bloque 8) es segura
//    de ofrecer con un click.
// 2. CANALES AJENOS (todo lo demás del servidor): NEXO no sabe para qué son. Se aplica
//    SOLO un heurístico transparente por nombre (contiene "staff"/"mod"/"admin"/"log"/
//    "registro"/"interno"/"privado") para señalar posibles canales pensados como
//    privados que quedaron visibles para @everyone — se marca como hallazgo de
//    REVISIÓN (🟡), nunca se ofrece corrección automática, y se aclara en el propio
//    texto que es un heurístico por nombre, no una certeza.
//
// Solo lee `guild.channels.cache` (ya en memoria, discord.js lo mantiene actualizado vía
// gateway con el intent que el bot ya tiene) — cero llamadas extra a la API de Discord.
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { STATUS } from './setupState.js';

const STAFF_NAME_HINTS = ['staff', 'mod', 'admin', 'log', 'registro', 'interno', 'privado', 'private'];

// Las columnas de guild_config que /setup gestiona directamente, con si SE ESPERA que
// @everyone tenga acceso o no — es la única fuente de "correcto" que NEXO puede afirmar
// con certeza (es la misma regla que /setup ya aplica al crear cada canal).
function managedChannelExpectations(cfg) {
  const map = new Map();
  for (const column of ['log_channel_moderation_id', 'log_channel_activity_id', 'log_channel_economy_id']) {
    if (cfg[column]) map.set(cfg[column], { everyoneShouldSee: false, staffShouldSee: true, label: 'canal de logs' });
  }
  if (cfg.welcome_channel_id) map.set(cfg.welcome_channel_id, { everyoneShouldSee: true, staffShouldSee: true, label: 'canal de bienvenida' });
  if (cfg.confession_channel_id) map.set(cfg.confession_channel_id, { everyoneShouldSee: true, staffShouldSee: true, label: 'canal de confesiones' });
  return map;
}

function everyoneCanView(channel, everyoneId) {
  const overwrite = channel.permissionOverwrites?.cache?.get(everyoneId);
  if (!overwrite) return true; // sin overwrite propio = hereda ver el canal (default)
  if (overwrite.deny?.has(PermissionFlagsBits.ViewChannel)) return false;
  if (overwrite.allow?.has(PermissionFlagsBits.ViewChannel)) return true;
  return true;
}

function staffCanView(channel, staffRoleId) {
  if (!staffRoleId) return null; // sin rol de staff configurado, no se puede evaluar
  const overwrite = channel.permissionOverwrites?.cache?.get(staffRoleId);
  if (overwrite?.allow?.has(PermissionFlagsBits.ViewChannel)) return true;
  if (overwrite?.deny?.has(PermissionFlagsBits.ViewChannel)) return false;
  // Sin overwrite explícito: si @everyone puede ver, el staff también (hereda) — si
  // @everyone NO puede ver y el staff tampoco tiene un allow explícito, el staff está
  // efectivamente afuera salvo que tenga el permiso a nivel de rol base (fuera de
  // alcance de este heurístico — se reporta como "no se puede confirmar acceso").
  return everyoneCanView(channel, channel.guild.roles.everyone.id);
}

function matchesStaffNameHint(name) {
  const lower = name.toLowerCase();
  return STAFF_NAME_HINTS.some((hint) => lower.includes(hint));
}

// Devuelve un array de hallazgos: { channelId, channelName, categoryName, status,
// summary, detail, correctable, correction }. `correction` (si existe) es la acción
// concreta que aplicaría Bloque 8 — solo presente para canales gestionados por NEXO.
export function scanGuildChannels(guild, cfg) {
  const everyoneId = guild.roles.everyone.id;
  const staffRoleId = cfg.moderator_role_id || null;
  const managed = managedChannelExpectations(cfg);
  const findings = [];

  for (const channel of guild.channels.cache.values()) {
    if (channel.type !== ChannelType.GuildText) continue;

    const categoryName = channel.parent?.name || null;
    const expectation = managed.get(channel.id);

    if (expectation) {
      const everyoneSees = everyoneCanView(channel, everyoneId);
      if (expectation.everyoneShouldSee === false && everyoneSees) {
        findings.push({
          channelId: channel.id,
          channelName: channel.name,
          categoryName,
          status: STATUS.ERROR,
          summary: `@everyone puede ver este ${expectation.label} — se supone que es solo para staff.`,
          detail: 'NEXO lo creó como privado (solo visible para el rol de staff). Alguien le dio acceso a @everyone después, a mano.',
          correctable: true,
          correction: { type: 'deny-everyone-view', channelId: channel.id },
        });
      }
      if (staffRoleId && expectation.staffShouldSee) {
        const staffSees = staffCanView(channel, staffRoleId);
        if (staffSees === false) {
          findings.push({
            channelId: channel.id,
            channelName: channel.name,
            categoryName,
            status: STATUS.WARN,
            summary: `El rol de staff no tiene acceso a este ${expectation.label}.`,
            detail: 'Un overwrite explícito le niega Ver canal al rol de staff configurado.',
            correctable: true,
            correction: { type: 'allow-staff-view', channelId: channel.id, roleId: staffRoleId },
          });
        }
      }
      continue; // ya evaluado con certeza — no se le aplica además el heurístico de abajo
    }

    // Heurístico de nombre, solo para canales que NEXO no gestiona — informativo, nunca
    // corregible desde acá.
    if (matchesStaffNameHint(channel.name) && everyoneCanView(channel, everyoneId)) {
      findings.push({
        channelId: channel.id,
        channelName: channel.name,
        categoryName,
        status: STATUS.WARN,
        summary: '@everyone puede ver este canal, y su nombre sugiere que podría ser privado.',
        detail: 'Detectado por el nombre del canal (heurístico) — no es un canal que NEXO gestione, revisalo a mano en Discord si corresponde.',
        correctable: false,
        correction: null,
      });
    }
  }

  return findings;
}

// Agrupa hallazgos por categoría, para el render tipo árbol del Bloque 7.
export function groupFindingsByCategory(findings) {
  const groups = new Map();
  for (const finding of findings) {
    const key = finding.categoryName || '(sin categoría)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(finding);
  }
  return groups;
}

// Aplica UNA corrección concreta (Bloque 8/9) — siempre una operación puntual y
// reversible por Discord nativo (el admin puede volver a tocar el overwrite a mano).
// Nunca aplica nada que scanGuildChannels no haya marcado explícitamente como
// `correctable: true`. Devuelve { ok: true } o { ok: false, reason }.
export async function applyChannelCorrection(guild, correction) {
  const channel = await guild.channels.fetch(correction.channelId).catch(() => null);
  if (!channel) return { ok: false, reason: 'El canal ya no existe.' };

  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return { ok: false, reason: 'A NEXO le falta el permiso "Gestionar canales".' };
  }
  // Un canal solo se puede editar si la posición del bot es mayor a la del rol más alto
  // afectado por el overwrite — chequeo real de jerarquía, no solo de permiso nativo.
  if (correction.roleId) {
    const role = guild.roles.cache.get(correction.roleId);
    if (role && me.roles.highest.position <= role.position) {
      return { ok: false, reason: 'NEXO no tiene posición suficiente para modificar ese overwrite.' };
    }
  }

  try {
    if (correction.type === 'deny-everyone-view') {
      await channel.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false }, { reason: 'Corrección de /setup — diagnóstico de canales' });
    } else if (correction.type === 'allow-staff-view') {
      await channel.permissionOverwrites.edit(correction.roleId, { ViewChannel: true }, { reason: 'Corrección de /setup — diagnóstico de canales' });
    } else {
      return { ok: false, reason: 'Tipo de corrección desconocido.' };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error?.message || 'Error desconocido aplicando el cambio.' };
  }
}
