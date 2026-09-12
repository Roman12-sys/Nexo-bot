// Chequeo de "¿sos el dueño REAL de esta aplicación de Discord?" — usado exclusivamente
// por /owner-metricas (plan de ejecución post-auditoría, Fase 5, 2026-09-12), el único
// comando del proyecto que ve datos de TODOS los servidores a la vez. A propósito NUNCA
// se gatea con isStaff()/isAdmin() (esos son por-guild, cualquier admin de un solo
// server los pasa) ni con un ID hardcodeado en una env var — se resuelve en vivo contra
// la API de Discord, mismo mecanismo que ya se usó para el gate de Spotify antes de que
// Music se eliminara del proyecto (Fase 3C).
//
// Gotcha real ya documentado en CLAUDE.md para ese caso: si la app está bajo un Team de
// Discord (el caso de NEXO), el campo `owner` de /oauth2/applications/@me representa al
// TEAM, no a la persona — el dueño real está en `team.owner_user_id`. Sin ese fallback,
// el dueño real de una app en team queda bloqueado por su propio gate.
import { config } from '../config.js';

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedOwnerId = null;
let cachedAt = 0;

async function fetchApplicationOwnerId() {
  const response = await fetch(`${DISCORD_API_BASE}/oauth2/applications/@me`, {
    headers: { Authorization: `Bot ${config.discordToken}` },
  });
  if (!response.ok) throw new Error(`No se pudo resolver el dueño de la aplicación (status ${response.status})`);

  const data = await response.json();
  return data.team?.owner_user_id || data.owner?.id || null;
}

export async function isBotOwner(userId) {
  const now = Date.now();
  if (!cachedOwnerId || now - cachedAt > CACHE_TTL_MS) {
    cachedOwnerId = await fetchApplicationOwnerId();
    cachedAt = now;
  }
  return cachedOwnerId === userId;
}
