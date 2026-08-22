// MIGRADO A SUPABASE (antes: confessions.json). El incremento del contador se hace con
// una función de Postgres (increment_confession_counter, ver SQL) en vez de leer-sumar-
// guardar acá: dos confesiones enviadas casi al mismo tiempo podrían leer el mismo
// número "actual" y terminar publicando dos confesiones con el mismo #N. La función
// SQL hace el incremento en una sola sentencia atómica, sin ese hueco.
import { supabase } from '../supabaseClient.js';

export async function getNextConfessionNumber(guildId) {
  const { data, error } = await supabase.rpc('increment_confession_counter', { p_guild_id: guildId });
  if (error) throw error;
  return data;
}
