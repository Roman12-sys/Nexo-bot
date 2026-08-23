// MIGRADO A SUPABASE (antes: warns.json). Toda función es async ahora — implica una
// llamada de red a Postgres. Cualquier caller tiene que hacer `await`.
//
// El "número" de advertencia (#1, #2, #3...) que ve el staff en /warns y /unwarn sigue
// siendo la posición 1-based en la lista ordenada por fecha de creación ascendente —
// mismo criterio que tenía el array de warns.json, solo que ahora el orden lo da
// "order by created_at asc" en vez de la posición dentro del array.
import { supabase } from '../supabaseClient.js';

const TABLE = 'warnings';

function rowToWarn(row) {
  return { reason: row.reason, moderatorId: row.moderator_id, timestamp: new Date(row.created_at).getTime() };
}

export async function getUserWarns(guildId, userId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('reason, moderator_id, created_at')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []).map(rowToWarn);
}

// Inserta la advertencia y devuelve la lista completa ya actualizada (mismo contrato que
// antes: warn.js usa list.length para mostrar "advertencia #N").
export async function addWarn(guildId, userId, warn) {
  const { error } = await supabase.from(TABLE).insert({
    guild_id: guildId,
    user_id: userId,
    reason: warn.reason,
    moderator_id: warn.moderatorId,
  });

  if (error) throw error;
  return getUserWarns(guildId, userId);
}

// Quita la advertencia en la posición 1-based "position" (la que se ve en /warns).
// Devuelve la advertencia borrada, o null si esa posición no existe.
export async function removeWarnAt(guildId, userId, position) {
  if (position < 1) return null;

  const { data: rows, error: selectError } = await supabase
    .from(TABLE)
    .select('id, reason, moderator_id, created_at')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .range(position - 1, position - 1);

  if (selectError) throw selectError;
  const row = rows?.[0];
  if (!row) return null;

  const { error: deleteError } = await supabase.from(TABLE).delete().eq('id', row.id);
  if (deleteError) throw deleteError;

  return rowToWarn(row);
}

// Corrige el motivo de la advertencia en la posición 1-based "position", SIN borrarla y
// recrearla — a diferencia de removeWarnAt, esto conserva la fecha original. Devuelve la
// advertencia ya actualizada, o null si esa posición no existe.
export async function updateWarnReasonAt(guildId, userId, position, newReason) {
  if (position < 1) return null;

  const { data: rows, error: selectError } = await supabase
    .from(TABLE)
    .select('id, reason, moderator_id, created_at')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .range(position - 1, position - 1);

  if (selectError) throw selectError;
  const row = rows?.[0];
  if (!row) return null;

  const { error: updateError } = await supabase.from(TABLE).update({ reason: newReason }).eq('id', row.id);
  if (updateError) throw updateError;

  return rowToWarn({ ...row, reason: newReason });
}

// Borra TODAS las advertencias de un usuario. Devuelve cuántas había (0 si no tenía).
export async function clearWarns(guildId, userId) {
  const { count, error: countError } = await supabase
    .from(TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('guild_id', guildId)
    .eq('user_id', userId);

  if (countError) throw countError;
  if (!count) return 0;

  const { error: deleteError } = await supabase.from(TABLE).delete().eq('guild_id', guildId).eq('user_id', userId);
  if (deleteError) throw deleteError;

  return count;
}

// Motivos más frecuentes de advertencia en el servidor — para el autocomplete de
// "motivo" en /warn. Se agrega en JS sobre las últimas 200 filas, mismo criterio que
// getGuildFrequentReasons en moderationActionsStore.js.
export async function getGuildFrequentWarnReasons(guildId, limit = 10) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('reason')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;

  const counts = new Map();
  for (const row of data || []) {
    const reason = (row.reason || '').trim();
    if (!reason) continue;
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([reason]) => reason);
}

// Devuelve TODAS las advertencias del servidor agrupadas por usuario: { userId: [warn, ...] }.
// Mismo shape que tenía el JSON — lo usa el panel /sanciones para armar el desplegable.
export async function getGuildWarns(guildId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('user_id, reason, moderator_id, created_at')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: true });

  if (error) throw error;

  const grouped = {};
  for (const row of data || []) {
    if (!grouped[row.user_id]) grouped[row.user_id] = [];
    grouped[row.user_id].push(rowToWarn(row));
  }
  return grouped;
}
