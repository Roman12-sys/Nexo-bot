// Todo el trato con Discord del dashboard va por REST con el token del bot (o el token
// OAuth del usuario para /users/@me) — a propósito NO hay una conexión de gateway acá.
// El dashboard es de solo lectura y de bajo tráfico, levantar un Client de discord.js
// entero (con sus intents, caché, reconexión) solo para consultar roles/miembros sería
// una segunda conexión innecesaria al mismo bot.
import { config } from '../src/config.js';
import { dashboardConfig } from './config.js';

const API_BASE = 'https://discord.com/api/v10';
const REDIRECT_URI = `${dashboardConfig.baseUrl}/auth/callback`;

export function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'identify',
    state,
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

export async function exchangeCodeForToken(code) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: dashboardConfig.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  });

  const res = await fetch(`${API_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Discord OAuth token exchange falló: ${res.status}`);
  return res.json();
}

export async function fetchDiscordUser(accessToken) {
  const res = await fetch(`${API_BASE}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`No se pudo obtener el usuario de Discord: ${res.status}`);
  return res.json();
}

// Usada para gatear /spotify/authorize: solo el dueño real de la aplicación (no
// cualquier admin de un server) puede disparar la autorización de Spotify — es un
// secreto a nivel bot completo, no algo que un staff cualquiera deba poder tocar.
// Cacheado en memoria: la propiedad de la app no cambia en la vida del proceso, no hace
// falta consultarlo en cada pedido.
let cachedOwnerId = null;

export async function fetchApplicationOwnerId() {
  if (cachedOwnerId) return cachedOwnerId;

  const res = await fetch(`${API_BASE}/oauth2/applications/@me`, {
    headers: { Authorization: `Bot ${config.discordToken}` },
  });
  if (!res.ok) throw new Error(`No se pudo consultar el dueño de la aplicación: ${res.status}`);

  const data = await res.json();
  cachedOwnerId = data.owner?.id || null;
  return cachedOwnerId;
}

// Usa el token del BOT (no el del usuario logueado) — todo lo de acá para abajo son
// datos que el bot ya puede ver por estar en el server, no requieren nada del usuario.
// Un 429 se reintenta UNA vez respetando retry_after — es el mismo token que usa el bot
// real en producción, así que ignorar el rate limit acá podría afectarlo a él también.
async function botFetch(path, { retried = false } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bot ${config.discordToken}` },
  });

  if (res.status === 404) return null;

  if (res.status === 429 && !retried) {
    const body = await res.json().catch(() => ({}));
    const retryAfterMs = Math.ceil((body.retry_after ?? 1) * 1000);
    await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
    return botFetch(path, { retried: true });
  }

  if (!res.ok) throw new Error(`Discord REST API falló (${path}): ${res.status}`);
  return res.json();
}

// Corre `fn` sobre `items` con como máximo `limit` llamadas en vuelo a la vez — evitar
// disparar decenas de requests en paralelo contra el token del bot (resolveUsers puede
// tener que resolver ~40 IDs de una sola carga de página).
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function fetchGuild(guildId, { withCounts = false } = {}) {
  return botFetch(`/guilds/${guildId}${withCounts ? '?with_counts=true' : ''}`);
}

export function fetchGuildMember(guildId, userId) {
  return botFetch(`/guilds/${guildId}/members/${userId}`);
}

// Para la tarjeta de "sancionados activos" del dashboard — src/utils/sanctions.js hace
// esto mismo pero vía guild.members.fetch() de discord.js; acá no hay un Client conectado
// al gateway, así que es la misma consulta por REST. Se limita a la primera página
// (1000 miembros, el máximo por página de Discord) — de sobra para el tamaño de server
// que usa este bot; si hay más, se avisa en vez de paginar sin límite.
export async function fetchGuildMembersWithRole(guildId, roleId) {
  const page = await botFetch(`/guilds/${guildId}/members?limit=1000`);
  const members = page || [];
  const withRole = members.filter((m) => m.roles?.includes(roleId));
  return { members: withRole, possiblyIncomplete: members.length >= 1000 };
}

export function fetchUser(userId) {
  return botFetch(`/users/${userId}`);
}

// Resuelve una lista de IDs de usuario a sus datos de Discord (username/avatar), sin
// pedir el mismo ID dos veces aunque aparezca repetido (ej. el mismo staff en varios warns).
export async function resolveUsers(userIds) {
  const uniqueIds = [...new Set(userIds)];
  const entries = await mapWithConcurrency(uniqueIds, 5, async (id) => [id, await fetchUser(id).catch(() => null)]);
  return new Map(entries);
}

export { mapWithConcurrency };
