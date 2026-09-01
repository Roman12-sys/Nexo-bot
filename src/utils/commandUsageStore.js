import { supabase } from '../supabaseClient.js';
import { eventBus } from './eventBus.js'; // Event Engine — auditoría 2026-08-29, Fase 5 (analytics)

// Fire-and-forget desde interactionCreate.js — nunca debe tirar ni frenar la
// respuesta de un comando por un problema de métricas.
//
// QUÉ SIGNIFICA "usos" (aclarado en la auditoría Fase 2B, sección 10 — antes este
// comentario decía "ejecución exitosa", impreciso): se llama solo si command.execute()
// no tiró una excepción — es decir, "intentos que el bot pudo procesar sin romperse",
// NO "resultados de negocio exitosos". Casi todos los comandos atrapan sus propios
// errores (permiso denegado, cooldown, saldo insuficiente, target inválido, etc.) en su
// propio try/catch y responden sin volver a tirar la excepción — interactionCreate.js
// no tiene (ni puede tener sin tocar los ~74 comandos) forma de distinguir eso de un
// éxito real. Para lo que esto alimenta hoy (/metricas: popularidad de comandos: y el
// logro de servidor por actividad total, ver guildAchievements.js) "intentos" es la
// semántica correcta, no un bug: por ejemplo un /rob rechazado por su 40% de éxito
// documentado sigue siendo interacción real con el comando, y contarlo como "no-uso"
// subestimaría su popularidad real. Si en el futuro hace falta una métrica de
// "resultados exitosos" de verdad, necesita una señal explícita por comando (return
// value o excepción en cada rama de rechazo) — cambio grande, deliberadamente fuera de
// esta fase.
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
