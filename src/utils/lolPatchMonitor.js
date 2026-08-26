// Segunda señal de monitoreo para el anunciador de patch notes de LoL — ADITIVA, no
// reemplaza a lolPatchEngine.js (que sigue siendo la única fuente de contenido real y
// la única que anuncia en Discord). Esto SOLO compara la versión de Data Dragon contra
// el estado del scraper y deja un warning en consola si parece que el scraper se rompió
// — nunca publica nada público.
//
// Por qué no confiar en Data Dragon como fuente principal (investigado 2026-08-26):
// Riot documenta que "Updating Data Dragon after each patch is a manual process, so it
// is not always updated immediately after a patch" (developer.riotgames.com/docs/lol)
// — no hay SLA de timing. Tampoco tiene contenido de patch notes, y su numeración de
// versión (ej. "16.17.1") no coincide con el nombre público del parche (ej. "Patch
// 26.17") de forma garantizada — no hay mapeo documentado entre ambos esquemas. Por eso
// esto nunca construye URLs ni títulos a partir de la versión de Data Dragon.
import { getLolPatchMonitorState, setLolDdragonVersionSeen, setLolDdragonWarningSent } from './lolPatchStore.js';

const DDRAGON_VERSIONS_URL = 'https://ddragon.leagueoflegends.com/api/versions.json';
const TICK_MS = 20 * 60 * 1000; // mismo intervalo que lolPatchEngine.js

// Ventana de tolerancia, en ambas direcciones alrededor del momento en que se detectó
// el cambio de versión de Data Dragon. En la práctica el artículo de patch notes suele
// publicarse ANTES de que Data Dragon se actualice (ver comentario de arriba), así que
// exigir que el scraper progrese DESPUÉS de este timestamp generaría un warning falso
// en cada parche normal. Con esta ventana simétrica alcanza con que el scraper haya
// encontrado un artículo nuevo en cualquier punto entre
// (detección - DDRAGON_PATCH_WARNING_DELAY_HOURS) y ahora. Conservador a propósito: HD
// de Data Dragon puede tardar más de lo esperado y no queremos falsos positivos.
const DDRAGON_PATCH_WARNING_DELAY_HOURS = 24;
const DDRAGON_PATCH_WARNING_DELAY_MS = DDRAGON_PATCH_WARNING_DELAY_HOURS * 60 * 60 * 1000;

async function fetchLatestDdragonVersion() {
  const res = await fetch(DDRAGON_VERSIONS_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} pidiendo versions.json de Data Dragon`);

  const versions = await res.json();
  if (!Array.isArray(versions) || typeof versions[0] !== 'string') {
    throw new Error('Respuesta de Data Dragon con forma inesperada (no es un array de strings)');
  }
  return versions[0];
}

export async function checkDdragonVersion() {
  const currentVersion = await fetchLatestDdragonVersion();
  const state = await getLolPatchMonitorState();
  const now = Date.now();

  if (state.lastDdragonVersion === null) {
    // Primera corrida: siembra sin comparar, no hay baseline todavía.
    await setLolDdragonVersionSeen(currentVersion, now);
    return;
  }

  if (state.lastDdragonVersion !== currentVersion) {
    console.log(`🐉 [patch notes LoL · monitor] Data Dragon cambió de versión: ${state.lastDdragonVersion} → ${currentVersion}`);
    await setLolDdragonVersionSeen(currentVersion, now);
    return; // arranca de cero la ventana de tolerancia para esta versión
  }

  // Misma versión que la corrida anterior: ¿ya venció la ventana sin que el scraper
  // haya progresado, y todavía no se avisó nada para esta versión puntual?
  if (!state.ddragonVersionDetectedAt || state.ddragonWarningSentAt) return;

  const elapsedSinceDetected = now - state.ddragonVersionDetectedAt;
  if (elapsedSinceDetected < DDRAGON_PATCH_WARNING_DELAY_MS) return;

  const windowStart = state.ddragonVersionDetectedAt - DDRAGON_PATCH_WARNING_DELAY_MS;
  const patchEngineProgressed = state.patchEngineUpdatedAt !== null && state.patchEngineUpdatedAt >= windowStart;
  if (patchEngineProgressed) return;

  console.warn(
    `⚠️ [patch notes LoL · monitor] Data Dragon está en la versión ${currentVersion} hace más de ` +
      `${DDRAGON_PATCH_WARNING_DELAY_HOURS}h y el scraper de patch notes no encontró ningún artículo nuevo en ese rango. ` +
      'Puede ser demora normal de publicación (de Riot o de Data Dragon) o que el scraper se haya roto ' +
      '(Riot cambió el sitio) — revisar manualmente.',
  );
  await setLolDdragonWarningSent(now);
}

export function startLolDdragonMonitorLoop() {
  checkDdragonVersion().catch((error) => console.error('❌ [patch notes LoL · monitor] Error en el chequeo inicial:', error));
  setInterval(() => {
    checkDdragonVersion().catch((error) => console.error('❌ [patch notes LoL · monitor] Error en el barrido:', error));
  }, TICK_MS).unref();
}
