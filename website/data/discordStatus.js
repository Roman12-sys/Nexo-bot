// Único dato realmente "en vivo" de /status: el status público de la plataforma de
// Discord (discordstatus.com/api/v2/status.json — API pública, sin auth, la misma que
// usa el badge oficial de Discord). NO hay nada equivalente para nuestro propio bot/
// dashboard/base de datos sin agregar un endpoint público nuevo en otro servicio — fuera
// de alcance de esta fase, ver el comentario en website/pages/status.js. Cacheado 60s en
// memoria para no pegarle a la API externa en cada request a /status.
const CACHE_TTL_MS = 60_000;
let cache = null; // { at, value }

const INDICATOR_LABELS = {
  none: 'Operativo',
  minor: 'Degradado (incidente menor)',
  major: 'Interrupción parcial',
  critical: 'Interrupción total',
};

export async function getDiscordPlatformStatus() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const response = await fetch('https://discordstatus.com/api/v2/status.json', { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`status.json respondió ${response.status}`);

    const data = await response.json();
    const indicator = data?.status?.indicator || 'unknown';
    const value = {
      known: true,
      indicator,
      label: INDICATOR_LABELS[indicator] || data?.status?.description || 'Desconocido',
    };
    cache = { at: Date.now(), value };
    return value;
  } catch (error) {
    console.error('⚠️ No se pudo consultar discordstatus.com:', error.message);
    const value = { known: false, indicator: 'unknown', label: 'Sin datos' };
    cache = { at: Date.now(), value };
    return value;
  }
}
