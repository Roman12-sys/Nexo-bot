import { supabase } from '../supabaseClient.js';
import { eventBus } from './eventBus.js'; // Event Engine — auditoría 2026-08-29, Fase 5 (analytics)

// Fire-and-forget desde interactionCreate.js — nunca debe tirar ni frenar la
// respuesta de un comando por un problema de métricas. Se llama solo tras una
// ejecución exitosa, así que "usos" refleja comandos que realmente corrieron.
//
// QUÉ CAMBIÓ: emite COMMAND_EXECUTED — único chokepoint real de "un comando corrió
// bien", igual criterio que addBalance/addXp para COINS_EARNED/XP_GAINED (Fase 3/5).
// QUÉ CAMBIÓ (Fase A, segunda auditoría 2026-08-30): ya no se hace `await` sobre el
// emit — mismo motivo que en economyStore/xpStore (no bloquear la operación de dominio
// esperando a un consumidor secundario). El caller de esta función (interactionCreate.js)
// ya la invoca sin await por su cuenta, así que esto no cambia la latencia visible del
// comando; sí evita que `getTotalUsage`/`checkCommandUsageAchievements` (que corren
// justo después, en la misma cadena fire-and-forget) esperen sin necesidad.
export async function trackCommandUsage(guildId, commandName) {
  if (!guildId) return;

  const { error } = await supabase.rpc('increment_command_usage', {
    p_guild_id: guildId,
    p_command_name: commandName,
  });

  if (error) console.error('❌ Error registrando métrica de uso de comando:', error);
  eventBus.emit('COMMAND_EXECUTED', { guildId, commandName }).catch(() => {});
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
