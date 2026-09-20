// Diagnóstico de canales/roles/permisos de /setup (NEXO Setup Inteligente, Bloques 6-9;
// ampliado a pedido explícito — "revisar todos los canales, todos los permisos, por
// rol, y revisar todos los roles").
//
// TRES fuentes de hallazgo, cada una con su propio nivel de certeza — no se puede
// "inventar" qué configuración es correcta para un canal/rol que NEXO no creó, así que
// cada una se apoya en algo verificable, nunca en una opinión de producto:
//
// 1. CANALES QUE NEXO GESTIONA (los 3 logs + bienvenida + confesiones, creados por
//    /setup): acá SÍ se conoce el estado correcto (el mismo que /setup ya aplica al
//    crearlos), así que el diagnóstico es preciso y la corrección (Bloque 8) es segura
//    de ofrecer con un click.
// 2. CUALQUIER CANAL (gestionado o no, de cualquier tipo — texto/voz/categoría/foro/
//    anuncios/stage) con un permiso PELIGROSO otorgado de más en un overwrite — reusa
//    getDangerousRolePermission (permissions.js), la MISMA lista ya usada por /setup,
//    /config y /punish, nunca un criterio nuevo. Esto es universal (no depende de para
//    qué es el canal: un rol con Banear/Expulsar/Gestionar roles/etc. otorgado en un
//    canal puntual es raro y vale la pena revisarlo pase lo que pase). Informativo
//    únicamente — a diferencia de los hallazgos "certeza" de arriba, acá no se sabe si
//    fue intencional, así que nunca se ofrece corrección automática.
// 3. TODOS LOS ROLES DEL SERVIDOR (no por canal) — cualquier rol, salvo el/los
//    configurados como staff/admin de NEXO, con un permiso peligroso a NIVEL BASE.
//    Mismo criterio de "universal, no depende de contexto" que el punto 2.
// 4. Heurístico transparente por nombre (contiene "staff"/"mod"/"admin"/"log"/
//    "registro"/"interno"/"privado") en canales NO gestionados por NEXO, para señalar
//    posibles canales pensados como privados que quedaron visibles para @everyone —
//    marcado como REVISIÓN (🟡), nunca corregible.
//
// Solo lee `guild.channels.cache`/`guild.roles.cache` (ya en memoria, discord.js los
// mantiene actualizados vía gateway) — cero llamadas extra a la API de Discord.
import { PermissionFlagsBits, OverwriteType } from 'discord.js';
import { STATUS } from './setupState.js';
import { getDangerousRolePermission } from './permissions.js';

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

// Escanea los overwrites de UN canal buscando un permiso peligroso otorgado a un ROL
// (nunca a un miembro puntual — eso es responsabilidad individual del staff, no una
// config de servidor) que no sea el rol de staff configurado (a ese SÍ se le permiten
// privilegios reales, a propósito, mismo criterio que el resto del proyecto). Universal:
// se aplica a CUALQUIER canal, gestionado por NEXO o no, de cualquier tipo — un permiso
// peligroso otorgado de más no depende de para qué es el canal.
function scanDangerousOverwrites(channel, staffRoleId, categoryName) {
  const findings = [];
  if (!channel.permissionOverwrites?.cache) return findings;

  for (const overwrite of channel.permissionOverwrites.cache.values()) {
    if (overwrite.type !== OverwriteType.Role) continue; // solo roles — overwrites de un usuario puntual quedan afuera
    if (overwrite.id === staffRoleId) continue;
    if (!overwrite.allow) continue;

    const dangerous = getDangerousRolePermission({ permissions: overwrite.allow });
    if (!dangerous) continue;

    const isEveryone = overwrite.id === channel.guild.roles.everyone.id;
    const role = isEveryone ? channel.guild.roles.everyone : channel.guild.roles.cache.get(overwrite.id);
    const roleLabel = isEveryone ? '@everyone' : role ? `El rol "${role.name}"` : 'Un rol que ya no existe';

    findings.push({
      kind: 'channel',
      channelId: channel.id,
      channelName: channel.name,
      categoryName,
      status: STATUS.ERROR,
      summary: `${roleLabel} tiene el permiso **${dangerous}** otorgado en este canal.`,
      detail: 'Un overwrite le da a ese rol un permiso normalmente reservado a staff — puede ser un error de configuración, revisalo a mano en Discord.',
      correctable: false, // no se sabe si fue intencional — solo se informa, nunca se toca
      correction: null,
    });
  }

  return findings;
}

// Devuelve un array de hallazgos: { kind, channelId, channelName, categoryName, status,
// summary, detail, correctable, correction }. `correction` (si existe) es la acción
// concreta que aplicaría Bloque 8 — solo presente para canales gestionados por NEXO.
export function scanGuildChannels(guild, cfg) {
  const everyoneId = guild.roles.everyone.id;
  const staffRoleId = cfg.moderator_role_id || null;
  const managed = managedChannelExpectations(cfg);
  const findings = [];

  for (const channel of guild.channels.cache.values()) {
    // Cualquier tipo de canal con su propia colección de overwrites (texto, voz,
    // categoría, foro, anuncios, stage) — los hilos NO tienen overwrites propios
    // (heredan del canal padre), así que quedan afuera solos, sin necesitar una lista
    // explícita de tipos.
    if (!channel.permissionOverwrites) continue;

    const categoryName = channel.parent?.name || null;
    const expectation = managed.get(channel.id);

    findings.push(...scanDangerousOverwrites(channel, staffRoleId, categoryName));

    if (expectation) {
      const everyoneSees = everyoneCanView(channel, everyoneId);
      if (expectation.everyoneShouldSee === false && everyoneSees) {
        findings.push({
          kind: 'channel',
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
            kind: 'channel',
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
        kind: 'channel',
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

// Auditoría de TODOS los roles del servidor (no por canal) — cualquier rol con un
// permiso peligroso a nivel BASE (no en un overwrite puntual, ver scanDangerousOverwrites
// arriba), salvo los configurados como staff/admin de NEXO (esos SÍ tienen privilegios
// reales a propósito) y los roles "managed" (integraciones — bots, Nitro Booster, roles
// de vínculo externo: Discord los gestiona solo, nunca los configuró un admin a mano).
export function scanGuildRoles(guild, cfg) {
  const findings = [];
  const protectedRoleIds = new Set([cfg.admin_role_id, cfg.moderator_role_id].filter(Boolean));

  for (const role of guild.roles.cache.values()) {
    if (role.id === guild.id) continue; // @everyone no es "un rol" a estos efectos
    if (protectedRoleIds.has(role.id)) continue;
    if (role.managed) continue;

    const dangerous = getDangerousRolePermission(role);
    if (!dangerous) continue;

    findings.push({
      kind: 'role',
      roleId: role.id,
      roleName: role.name,
      status: STATUS.WARN,
      summary: `El rol **${role.name}** tiene el permiso **${dangerous}**, y no es tu rol de staff/administrador configurado.`,
      detail: 'Puede ser intencional (roles de confianza, co-founders, etc.) — revisalo si no lo esperabas.',
      correctable: false,
      correction: null,
    });
  }

  return findings;
}

// Agrupa hallazgos de CANALES por categoría, para el render tipo árbol del Bloque 7 —
// los hallazgos de rol (kind: 'role') se renderizan aparte, no tienen categoría.
export function groupFindingsByCategory(findings) {
  const groups = new Map();
  for (const finding of findings) {
    if (finding.kind === 'role') continue;
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
