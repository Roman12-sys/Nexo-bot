// Estado del anunciador de patch notes de LoL (ver lolPatchEngine.js). Una sola fila
// fija (id = STATE_ID) — no es por guild, el canal de anuncio es fijo.
import { supabase } from '../supabaseClient.js';

const STATE_ID = 'league_of_legends';

export async function getLastAnnouncedPatchUrl() {
  const { data, error } = await supabase
    .from('lol_patch_state')
    .select('last_url')
    .eq('id', STATE_ID)
    .maybeSingle();
  if (error) throw error;
  return data?.last_url ?? null;
}

export async function setLastAnnouncedPatchUrl(url) {
  const { error } = await supabase
    .from('lol_patch_state')
    .upsert({ id: STATE_ID, last_url: url, updated_at: new Date().toISOString() });
  if (error) throw error;
}
