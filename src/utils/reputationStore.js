// MIGRADO A SUPABASE (antes: reputation.json). Toda función es async ahora.
import { supabase } from '../supabaseClient.js';

const TABLE = 'reputation';

function rowToRecord(row) {
  if (!row) return { total: 0, lastGiven: 0 };
  return { total: row.total, lastGiven: row.last_given };
}

export async function getUserReputation(guildId, userId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('total, last_given')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return rowToRecord(data);
}

export async function saveUserReputation(guildId, userId, data) {
  const { error } = await supabase
    .from(TABLE)
    .upsert({ guild_id: guildId, user_id: userId, total: data.total, last_given: data.lastGiven }, { onConflict: 'guild_id,user_id' });

  if (error) throw error;
}

// Suma (o resta) puntos de reputación de forma atómica — usa el RPC increment_reputation
// en vez de leer-sumar-guardar, así dos /reputation al mismo usuario en el mismo instante
// no se pisan (mismo patrón que increment_balance/increment_xp). Devuelve el nuevo total.
export async function addReputation(guildId, userId, amount) {
  const { data: newTotal, error } = await supabase.rpc('increment_reputation', {
    p_guild_id: guildId,
    p_user_id: userId,
    p_amount: amount,
  });

  if (error) throw error;
  return newTotal;
}

// Ranking del servidor, mayor a menor — mismo patrón que getGuildEconomy/getGuildXp.
// No existía ninguna función de esto todavía: /reputation solo podía mostrar TU propio
// total (vía /perfil), nunca el top del servidor.
export async function getGuildReputation(guildId, { limit } = {}) {
  let query = supabase.from(TABLE).select('user_id, total').eq('guild_id', guildId).order('total', { ascending: false });
  if (limit) query = query.limit(limit);

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map((row) => ({ userId: row.user_id, total: row.total }));
}

// Actualiza SOLO el cooldown de "última vez que dio reputación" de un usuario, sin tocar
// su total — evita que un total cambiado por otra acción concurrente se pise. El RPC
// (amount 0) garantiza que la fila exista antes de este UPDATE de una sola columna.
export async function touchLastGiven(guildId, userId, timestamp) {
  await addReputation(guildId, userId, 0);
  const { error } = await supabase
    .from(TABLE)
    .update({ last_given: timestamp })
    .eq('guild_id', guildId)
    .eq('user_id', userId);

  if (error) throw error;
}
