// Data puro (sin llamadas a Discord) — mismo split que giveawaysStore.js/
// giveawayEngine.js. reminderEngine.js es el lado que sí manda el DM.
import { supabase } from '../supabaseClient.js';

const TABLE = 'reminders';

function rowToReminder(row) {
  return {
    id: row.id,
    guildId: row.guild_id,
    userId: row.user_id,
    message: row.message,
    remindAt: row.remind_at,
    repeatMs: row.repeat_ms || null,
  };
}

// repeatMs null = recordatorio de una sola vez (como siempre fue). Si viene con valor,
// reminderEngine.js lo reprograma solo en vez de borrarlo cada vez que dispara.
export async function createReminder(guildId, userId, message, remindAt, repeatMs = null) {
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ guild_id: guildId, user_id: userId, message, remind_at: remindAt, repeat_ms: repeatMs })
    .select('*')
    .single();

  if (error) throw error;
  return rowToReminder(data);
}

// Reprograma un recordatorio RECURRENTE para la próxima vez, sin borrar la fila (a
// diferencia de deleteReminder, que sí se usa para los de una sola vez).
export async function rescheduleReminder(id, nextRemindAt) {
  const { error } = await supabase.from(TABLE).update({ remind_at: nextRemindAt }).eq('id', id);
  if (error) throw error;
}

export async function getUserReminders(guildId, userId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .order('remind_at', { ascending: true });

  if (error) throw error;
  return (data || []).map(rowToReminder);
}

// Usado por reminderEngine.js al reiniciar: TODOS los recordatorios pendientes, de
// todos los servidores, para reprogramar los timers que se pierden en cada redeploy.
export async function getAllReminders() {
  const { data, error } = await supabase.from(TABLE).select('*');
  if (error) throw error;
  return (data || []).map(rowToReminder);
}

export async function deleteReminder(id) {
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw error;
}
