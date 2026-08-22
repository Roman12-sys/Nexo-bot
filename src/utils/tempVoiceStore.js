// Registro de salas de voz temporales (tabla temporary_voice_channels). Data layer puro
// (sin llamadas a Discord), mismo patrón que economyStore.js/xpStore.js. El motor que
// sí habla con la API de Discord vive en tempVoiceEngine.js.
import { supabase } from '../supabaseClient.js';

const TABLE = 'temporary_voice_channels';
const STATS_TABLE = 'voice_channel_stats';

function rowToRecord(row) {
  if (!row) return null;
  return {
    guildId: row.guild_id,
    channelId: row.channel_id,
    ownerId: row.owner_id,
    categoryId: row.category_id,
    type: row.type,
    locked: row.locked,
    createdAt: row.created_at,
  };
}

// owner_id tiene un UNIQUE (guild_id, owner_id) en la tabla — un usuario no puede tener
// dos salas temporales registradas a la vez. tempVoiceEngine.js ya chequea esto antes de
// llamar acá (para poder redirigir al usuario a su sala existente en vez de fallar), pero
// la constraint queda como red de seguridad ante una condición de carrera real.
export async function createTempChannel({ guildId, channelId, ownerId, categoryId, type }) {
  const { error } = await supabase.from(TABLE).insert({
    guild_id: guildId,
    channel_id: channelId,
    owner_id: ownerId,
    category_id: categoryId,
    type,
    locked: false,
  });

  if (error) throw error;
}

export async function getTempChannelByChannelId(guildId, channelId) {
  const { data, error } = await supabase.from(TABLE).select('*').eq('guild_id', guildId).eq('channel_id', channelId).maybeSingle();
  if (error) throw error;
  return rowToRecord(data);
}

export async function getTempChannelByOwner(guildId, ownerId) {
  const { data, error } = await supabase.from(TABLE).select('*').eq('guild_id', guildId).eq('owner_id', ownerId).maybeSingle();
  if (error) throw error;
  return rowToRecord(data);
}

export async function updateTempChannel(guildId, channelId, patch) {
  const row = {};
  if ('type' in patch) row.type = patch.type;
  if ('locked' in patch) row.locked = patch.locked;

  const { data, error } = await supabase.from(TABLE).update(row).eq('guild_id', guildId).eq('channel_id', channelId).select('*').maybeSingle();
  if (error) throw error;
  return rowToRecord(data);
}

export async function deleteTempChannel(guildId, channelId) {
  const { error } = await supabase.from(TABLE).delete().eq('guild_id', guildId).eq('channel_id', channelId);
  if (error) throw error;
}

// /voice (panel) "Transferir propietario": cambia el dueño registrado. No toca
// permission overwrites del canal — eso lo maneja tempVoiceEngine.js aparte.
export async function transferTempChannelOwner(guildId, channelId, newOwnerId) {
  const { data, error } = await supabase.from(TABLE).update({ owner_id: newOwnerId }).eq('guild_id', guildId).eq('channel_id', channelId).select('*').maybeSingle();
  if (error) throw error;
  return rowToRecord(data);
}

// Usado por ready.js al reiniciar: todas las salas registradas de un guild, para
// comprobar cuáles siguen existiendo de verdad.
export async function getAllTempChannels(guildId) {
  const { data, error } = await supabase.from(TABLE).select('*').eq('guild_id', guildId);
  if (error) throw error;
  return (data || []).map(rowToRecord);
}

// Estadísticas: una fila por sala TERMINADA (se escribe recién al borrarla, con el
// resumen completo de su vida — nunca una fila por evento). Ver tempVoiceEngine.js
// para de dónde salen unique_users_count/max_concurrent_users.
export async function recordChannelStats({ guildId, channelId, ownerId, type, createdAt, durationSeconds, uniqueUsersCount, maxConcurrentUsers }) {
  const { error } = await supabase.from(STATS_TABLE).insert({
    guild_id: guildId,
    channel_id: channelId,
    owner_id: ownerId,
    type,
    created_at: createdAt,
    duration_seconds: durationSeconds,
    unique_users_count: uniqueUsersCount,
    max_concurrent_users: maxConcurrentUsers,
  });
  if (error) throw error;
}
