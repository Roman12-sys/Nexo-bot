// Historial persistente de sanciones (bans/kicks/timeouts/punish/unban) — hasta ahora
// solo /warns quedaba en una tabla consultable; el resto de las acciones de moderación
// solo quedaban en el canal de logs de Discord, sin forma de pedirle al bot "mostrame
// todas las sanciones de este usuario" sin scrollear a mano.
import { supabase } from '../supabaseClient.js';

const TABLE = 'moderation_actions';

function rowToAction(row) {
  return {
    actionType: row.action_type,
    moderatorId: row.moderator_id,
    reason: row.reason,
    extra: row.extra || {},
    timestamp: new Date(row.created_at).getTime(),
  };
}

// No bloqueante a propósito para el caller: registrar el historial nunca debe impedir
// que la sanción en sí (ya aplicada en Discord) se confirme al staff. Cada comando la
// llama en su propio try/catch, mismo criterio que el log al canal de moderación.
export async function recordModerationAction(guildId, userId, { actionType, moderatorId, reason, extra }) {
  const { error } = await supabase.from(TABLE).insert({
    guild_id: guildId,
    user_id: userId,
    action_type: actionType,
    moderator_id: moderatorId,
    reason: reason || null,
    extra: extra || {},
  });

  if (error) throw error;
}

export async function getUserModerationActions(guildId, userId, limit = 100) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('action_type, moderator_id, reason, extra, created_at')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data || []).map(rowToAction);
}

// Motivos más frecuentes de un tipo de acción en el servidor — para el autocomplete de
// "motivo" en /ban, /kick, /timeout, /punish. Se agrega en JS sobre las últimas N filas
// (no hay una sola tabla enorme por servidor) en vez de un RPC de agregación aparte.
export async function getGuildFrequentReasons(guildId, actionType, limit = 10) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('reason')
    .eq('guild_id', guildId)
    .eq('action_type', actionType)
    .not('reason', 'is', null)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;

  const counts = new Map();
  for (const row of data || []) {
    const reason = row.reason.trim();
    if (!reason) continue;
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([reason]) => reason);
}
