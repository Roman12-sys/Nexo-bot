// QUÉ CAMBIÓ: archivo nuevo. Lado "con acceso a Discord" de las restricciones con
// duración — mismo split que reminderEngine.js: quita el rol, loguea, limpia el
// registro. Los setTimeout se pierden en cada redeploy de Railway, por eso
// rescheduleActivePunishments() existe (llamada desde ready.js), igual que
// rescheduleReminders()/rescheduleActiveGiveaways().
// MOTIVO: auditoría 2026-08-29 (Diagnóstico Nexo, Parte 22) — /punish no tenía
// expiración automática. A diferencia de reminderEngine.js, acá NO hace falta
// encadenar timeouts intermedios: la duración máxima que ofrece /punish es 7 días,
// muy por debajo del límite de setTimeout de Node (~24.8 días).
// VALIDACIÓN: aplicar /punish con duración corta (ej. si se prueba a mano bajando
// DURATION_MS.'1h' temporalmente), confirmar que el rol se quita solo y que queda un
// log en el canal de moderación diciendo que expiró.
import { getGuildLogChannel } from './guildLogChannels.js';
import { createPunishLogEmbed } from './logEmbeds.js';
import { recordModerationAction } from './moderationActionsStore.js';
import { getAllActivePunishments, deleteActivePunishment } from './punishStore.js';

// Handle del setTimeout activo por restricción — sin esto, /unpunish manual solo podía
// borrar la fila de Supabase, pero el timer en memoria seguía vivo e intentaba quitar
// el rol igual (no rompe nada porque roles.remove es un no-op si ya no lo tiene, pero
// sí podía mandar un log de "expiró" después de que ya se sacó a mano).
const activeTimeouts = new Map(); // `${guildId}:${userId}` -> Timeout

function key(guildId, userId) {
  return `${guildId}:${userId}`;
}

async function expirePunishment(client, { guildId, userId, roleId }) {
  activeTimeouts.delete(key(guildId, userId));

  try {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;

    if (member?.roles.cache.has(roleId)) {
      await member.roles.remove(roleId, 'Restricción de /punish expirada automáticamente').catch((error) => {
        console.error('⚠️ No se pudo quitar el rol de restricción vencida:', error);
      });
    }

    const user = member?.user || (await client.users.fetch(userId).catch(() => null));
    const reason = 'Expiración automática (duración configurada al aplicar la restricción)';

    try {
      const logChannel = await getGuildLogChannel(client, guildId, 'moderation');
      if (logChannel) {
        if (user) {
          await logChannel.send({ embeds: [createPunishLogEmbed({ user, executor: client.user, reason, applied: false })] });
        } else {
          await logChannel.send(`✅ La restricción de <@${userId}> expiró automáticamente.`);
        }
      }
    } catch (logError) {
      console.error('⚠️ No se pudo registrar la expiración de /punish en el canal de logs:', logError);
    }

    await recordModerationAction(guildId, userId, {
      actionType: 'punish_remove',
      moderatorId: client.user.id,
      reason,
    }).catch((error) => console.error('⚠️ No se pudo registrar la expiración de /punish en el historial:', error));
  } finally {
    await deleteActivePunishment(guildId, userId).catch((error) => console.error('❌ Error borrando restricción vencida:', error));
  }
}

export function schedulePunishExpiry(client, { guildId, userId, roleId, expiresAt }) {
  // Si ya había un timer viejo para este usuario (ej. reschedule al boot pisando uno que
  // ya se había programado en este mismo proceso), cancelarlo antes de programar el nuevo.
  const oldHandle = activeTimeouts.get(key(guildId, userId));
  if (oldHandle) clearTimeout(oldHandle);

  const delay = expiresAt - Date.now();

  if (delay <= 0) {
    activeTimeouts.delete(key(guildId, userId));
    expirePunishment(client, { guildId, userId, roleId }).catch((error) => console.error('❌ Error expirando restricción:', error));
    return;
  }

  const handle = setTimeout(() => {
    expirePunishment(client, { guildId, userId, roleId }).catch((error) => console.error('❌ Error expirando restricción:', error));
  }, delay).unref();
  activeTimeouts.set(key(guildId, userId), handle);
}

// Cancela el timer en memoria (llamado por /unpunish manual) — borrar la fila de
// Supabase es responsabilidad del caller (mismo patrón que reminderEngine.cancelReminder).
export function cancelPunishExpiry(guildId, userId) {
  const handle = activeTimeouts.get(key(guildId, userId));
  if (handle) {
    clearTimeout(handle);
    activeTimeouts.delete(key(guildId, userId));
  }
}

export async function rescheduleActivePunishments(client) {
  const punishments = await getAllActivePunishments();
  for (const punishment of punishments) {
    schedulePunishExpiry(client, punishment);
  }
}
