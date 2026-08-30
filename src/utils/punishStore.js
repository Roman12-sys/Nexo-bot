// QUÉ CAMBIÓ: archivo nuevo. Data puro (sin llamadas a Discord) — mismo split que
// remindersStore.js/reminderEngine.js y giveawaysStore.js/giveawayEngine.js.
// punishEngine.js es el lado que sí quita el rol en Discord y loguea.
// MOTIVO: auditoría 2026-08-29 (Diagnóstico Nexo, Parte 22) — /punish no tenía
// expiración automática, era 100% manual a diferencia de /timeout. Solo se crea una
// fila acá cuando el staff elige una duración explícita en /punish — si no, la
// restricción sigue siendo indefinida/manual como siempre, sin ninguna fila nueva.
// VERIFICACIÓN: aplicar /punish con duración, confirmar la fila en Supabase
// (tabla active_punishments) y que desaparece sola al expirar o al hacer /unpunish.
import { supabase } from '../supabaseClient.js';

const TABLE = 'active_punishments';

function rowToPunishment(row) {
  return {
    guildId: row.guild_id,
    userId: row.user_id,
    roleId: row.role_id,
    expiresAt: row.expires_at,
  };
}

// Un solo registro activo por usuario (PK guild_id+user_id) — /punish ya rechaza
// re-aplicar la restricción a alguien que ya la tiene, así que un upsert acá nunca
// pisa un timer "más nuevo" por accidente.
export async function createActivePunishment(guildId, userId, roleId, expiresAt) {
  const { error } = await supabase
    .from(TABLE)
    .upsert({ guild_id: guildId, user_id: userId, role_id: roleId, expires_at: expiresAt, created_at: Date.now() }, { onConflict: 'guild_id,user_id' });

  if (error) throw error;
}

export async function getActivePunishment(guildId, userId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data ? rowToPunishment(data) : null;
}

// Usado por punishEngine.js al reiniciar: TODAS las restricciones con timer pendiente,
// de todos los servidores, para reprogramar los timers que se pierden en cada redeploy.
export async function getAllActivePunishments() {
  const { data, error } = await supabase.from(TABLE).select('*');
  if (error) throw error;
  return (data || []).map(rowToPunishment);
}

export async function deleteActivePunishment(guildId, userId) {
  const { error } = await supabase.from(TABLE).delete().eq('guild_id', guildId).eq('user_id', userId);
  if (error) throw error;
}
