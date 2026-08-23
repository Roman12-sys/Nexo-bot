// MIGRADO A SUPABASE (antes: giveaways.json). Toda función es async ahora.
//
// Los participantes ya NO viven como array embebido dentro del sorteo — pasaron a
// tener su propia tabla (giveaway_entries), una fila por usuario. Esto además arregla
// una condición de carrera real que tenía el JSON: dos usuarios tocando "Participar"
// casi al mismo tiempo leían el mismo array y podían pisarse la escritura del otro
// (el segundo en guardar borraba al primero). Con una fila por usuario, cada quien
// inserta/borra SU propia fila — no hay nada compartido que pisar.
import { supabase } from '../supabaseClient.js';

const GIVEAWAYS_TABLE = 'giveaways';
const ENTRIES_TABLE = 'giveaway_entries';

function rowToGiveaway(row, participants) {
  return {
    channelId: row.channel_id,
    prize: row.prize,
    winnersCount: row.winners_count,
    endTimestamp: row.end_timestamp,
    ended: row.ended,
    cancelled: row.cancelled,
    winners: row.winners || [],
    creatorId: row.creator_id,
    participants,
  };
}

export async function getGiveaway(guildId, messageId) {
  const { data: row, error } = await supabase
    .from(GIVEAWAYS_TABLE)
    .select('*')
    .eq('guild_id', guildId)
    .eq('message_id', messageId)
    .maybeSingle();

  if (error) throw error;
  if (!row) return null;

  const { data: entries, error: entriesError } = await supabase
    .from(ENTRIES_TABLE)
    .select('user_id')
    .eq('guild_id', guildId)
    .eq('message_id', messageId);

  if (entriesError) throw entriesError;

  return rowToGiveaway(row, (entries || []).map((e) => e.user_id));
}

// Crea un sorteo nuevo. Arranca siempre sin participantes (recién se publicó),
// así que no hace falta tocar giveaway_entries acá.
export async function saveGiveaway(guildId, messageId, data) {
  const { error } = await supabase.from(GIVEAWAYS_TABLE).insert({
    guild_id: guildId,
    message_id: messageId,
    channel_id: data.channelId,
    prize: data.prize,
    winners_count: data.winnersCount,
    end_timestamp: data.endTimestamp,
    ended: data.ended || false,
    cancelled: false,
    winners: data.winners || [],
    creator_id: data.creatorId,
  });

  if (error) throw error;
}

// Actualiza campos del sorteo en sí (ended/cancelled/winners) — NO participantes,
// para eso está toggleParticipant. Devuelve el sorteo completo ya actualizado.
export async function updateGiveaway(guildId, messageId, updates) {
  const patch = {};
  if ('ended' in updates) patch.ended = updates.ended;
  if ('cancelled' in updates) patch.cancelled = updates.cancelled;
  if ('winners' in updates) patch.winners = updates.winners;

  const { error } = await supabase.from(GIVEAWAYS_TABLE).update(patch).eq('guild_id', guildId).eq('message_id', messageId);
  if (error) throw error;

  return getGiveaway(guildId, messageId);
}

// Entra/sale del sorteo (botón "🎉 Participar"). Atómico por diseño: cada usuario
// solo toca su propia fila en giveaway_entries, nunca un array compartido.
export async function toggleParticipant(guildId, messageId, userId) {
  const { data: existing, error: selectError } = await supabase
    .from(ENTRIES_TABLE)
    .select('user_id')
    .eq('guild_id', guildId)
    .eq('message_id', messageId)
    .eq('user_id', userId)
    .maybeSingle();

  if (selectError) throw selectError;

  if (existing) {
    const { error } = await supabase
      .from(ENTRIES_TABLE)
      .delete()
      .eq('guild_id', guildId)
      .eq('message_id', messageId)
      .eq('user_id', userId);
    if (error) throw error;
    return { joined: false };
  }

  const { error } = await supabase.from(ENTRIES_TABLE).insert({ guild_id: guildId, message_id: messageId, user_id: userId });
  // Doble-click casi simultáneo: dos toggles del mismo usuario pueden pasar el SELECT
  // de arriba (todavía sin fila) antes de que ninguno inserte. El segundo INSERT choca
  // con la primary key (guild_id, message_id, user_id) — eso significa que YA está
  // participando (el primer click ganó), no un error real.
  if (error && error.code !== '23505') throw error;
  return { joined: true };
}

// Todos los sorteos que todavía no terminaron, de TODOS los servidores — lo usa
// rescheduleActiveGiveaways() al arrancar el bot para reprogramar los temporizadores
// que se perdieron al reiniciar (no hace falta la lista de participantes acá).
export async function getActiveGiveaways() {
  const { data, error } = await supabase
    .from(GIVEAWAYS_TABLE)
    .select('guild_id, message_id, end_timestamp')
    .eq('ended', false);

  if (error) throw error;
  return (data || []).map((row) => ({ guildId: row.guild_id, messageId: row.message_id, endTimestamp: row.end_timestamp }));
}

// Cuenta en cuántos sorteos ya finalizados salió ganador un usuario. Se calcula al
// vuelo recorriendo los sorteos del servidor — no es un contador guardado aparte,
// así nunca puede desincronizarse de la lista real de "winners" de cada uno.
export async function getUserWinCount(guildId, userId) {
  const { data, error } = await supabase.from(GIVEAWAYS_TABLE).select('winners').eq('guild_id', guildId).eq('ended', true);
  if (error) throw error;
  return (data || []).filter((row) => (row.winners || []).includes(userId)).length;
}
