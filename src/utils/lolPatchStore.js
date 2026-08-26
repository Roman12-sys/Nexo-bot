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

// Estado del monitor secundario de Data Dragon (ver lolPatchMonitor.js) — mismas filas
// que el anunciador (una sola fila fija), columnas separadas. `updated_at` de arriba se
// reutiliza tal cual como "última vez que el scraper encontró un artículo nuevo": ya se
// actualiza solo en ese caso (ver checkForNewPatch en lolPatchEngine.js), no hace falta
// una columna redundante para lo mismo.
export async function getLolPatchMonitorState() {
  const { data, error } = await supabase
    .from('lol_patch_state')
    .select('updated_at, last_ddragon_version, ddragon_version_detected_at, ddragon_warning_sent_at')
    .eq('id', STATE_ID)
    .maybeSingle();
  if (error) throw error;

  return {
    patchEngineUpdatedAt: data?.updated_at ? new Date(data.updated_at).getTime() : null,
    lastDdragonVersion: data?.last_ddragon_version ?? null,
    ddragonVersionDetectedAt: data?.ddragon_version_detected_at ?? null,
    ddragonWarningSentAt: data?.ddragon_warning_sent_at ?? null,
  };
}

// `detectedAt` en epoch ms (no timestamptz) — se le hace aritmética cruda con Date.now()
// en lolPatchMonitor.js, mismo criterio que last_daily/last_work (ver CLAUDE.md).
// Pisa ddragon_warning_sent_at a null: una versión nueva empieza su propia ventana de
// tolerancia de cero, cualquier warning viejo ya no aplica.
export async function setLolDdragonVersionSeen(version, detectedAt) {
  const { error } = await supabase
    .from('lol_patch_state')
    .upsert({ id: STATE_ID, last_ddragon_version: version, ddragon_version_detected_at: detectedAt, ddragon_warning_sent_at: null });
  if (error) throw error;
}

export async function setLolDdragonWarningSent(sentAt) {
  const { error } = await supabase
    .from('lol_patch_state')
    .update({ ddragon_warning_sent_at: sentAt })
    .eq('id', STATE_ID);
  if (error) throw error;
}
