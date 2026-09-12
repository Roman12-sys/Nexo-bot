// Observabilidad de negocio (plan de ejecución post-auditoría, Fase 5, 2026-09-12) —
// registra altas/bajas de servidor para que /owner-metricas pueda mostrar crecimiento
// real (cuántos guilds se sumaron/se fueron en una ventana), algo que ninguna analítica
// existente cubre (guild_daily_stats es estrictamente por-guild). Tabla mínima a
// propósito: un evento, sin más detalle — no es un log de auditoría ni reemplaza nada.
import { supabase } from '../supabaseClient.js';

const TABLE = 'bot_guild_events';

// Best-effort a propósito: se llama desde guildCreate.js/guildDelete.js, ninguno de los
// dos debe romperse si esto falla (una falla acá no debe impedir el mensaje de
// bienvenida ni la limpieza real de datos del guild).
export async function recordGuildEvent(guildId, eventType) {
  const { error } = await supabase.from(TABLE).insert({ guild_id: guildId, event_type: eventType });
  if (error) console.error(`⚠️ No se pudo registrar el evento "${eventType}" de guild ${guildId}:`, error);
}

// Cuenta joins/leaves desde sinceMs (epoch ms) hasta ahora — 2 counts baratos
// (count: 'exact', head: true), no una fila por evento traída a JS para contarla acá.
export async function getGuildEventCounts(sinceMs) {
  const sinceIso = new Date(sinceMs).toISOString();

  const [joinsResult, leavesResult] = await Promise.all([
    supabase.from(TABLE).select('id', { count: 'exact', head: true }).eq('event_type', 'join').gte('created_at', sinceIso),
    supabase.from(TABLE).select('id', { count: 'exact', head: true }).eq('event_type', 'leave').gte('created_at', sinceIso),
  ]);

  if (joinsResult.error) throw joinsResult.error;
  if (leavesResult.error) throw leavesResult.error;

  return { joins: joinsResult.count ?? 0, leaves: leavesResult.count ?? 0 };
}
