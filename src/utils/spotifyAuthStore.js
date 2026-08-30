// Capa de datos pura para la fila única de autorización de Spotify (tabla spotify_auth)
// — mismo rol que tempVoiceStore.js: sin lógica de negocio, sin llamadas HTTP a
// Spotify/Discord, solo Supabase. La escribe dashboard/server.js (al completar el
// callback de OAuth); la lee src/utils/spotifyResolver.js (para saber si hay un usuario
// autorizado antes de caer a Client Credentials Flow).
import { supabase } from '../supabaseClient.js';

const TABLE = 'spotify_auth';
const ROW_ID = 'main'; // fila única a nivel bot, no por guild — mismo criterio que lol_patch_state

export async function getSpotifyRefreshToken() {
  const { data, error } = await supabase.from(TABLE).select('refresh_token, authorized_by, updated_at').eq('id', ROW_ID).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { refreshToken: data.refresh_token, authorizedBy: data.authorized_by, updatedAt: data.updated_at };
}

export async function saveSpotifyRefreshToken(refreshToken, authorizedByUserId) {
  const { error } = await supabase
    .from(TABLE)
    .upsert({ id: ROW_ID, refresh_token: refreshToken, authorized_by: authorizedByUserId, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) throw error;
}
