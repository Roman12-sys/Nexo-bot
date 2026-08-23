import { supabase } from '../supabaseClient.js';

// Fire-and-forget desde interactionCreate.js — nunca debe tirar ni frenar la
// respuesta de un comando por un problema de métricas. Se llama solo tras una
// ejecución exitosa, así que "usos" refleja comandos que realmente corrieron.
export async function trackCommandUsage(guildId, commandName) {
  if (!guildId) return;

  const { error } = await supabase.rpc('increment_command_usage', {
    p_guild_id: guildId,
    p_command_name: commandName,
  });

  if (error) console.error('❌ Error registrando métrica de uso de comando:', error);
}

export async function getTopCommands(guildId, limit = 10) {
  const { data, error } = await supabase
    .from('command_usage')
    .select('command_name, uses, last_used_at')
    .eq('guild_id', guildId)
    .order('uses', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function getTotalUsage(guildId) {
  const { data, error } = await supabase.from('command_usage').select('uses').eq('guild_id', guildId);
  if (error) throw error;
  return data.reduce((sum, row) => sum + Number(row.uses), 0);
}
