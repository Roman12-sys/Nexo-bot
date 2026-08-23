// Detección de spam en memoria — mismo trade-off que rateLimiter.js/afkStore.js: perder
// el historial en un redeploy no tiene consecuencia real, vuelve a arrancar en cero.
// Tres señales, la primera que dispare gana: menciones masivas, flood (muchos mensajes
// seguidos) y contenido duplicado (mismo texto repetido varias veces).

const FLOOD_WINDOW_MS = 6_000;
const FLOOD_THRESHOLD = 5;

const DUPLICATE_WINDOW_MS = 15_000;
const DUPLICATE_THRESHOLD = 3;

const MASS_MENTION_THRESHOLD = 6;

const CLEANUP_INTERVAL_MS = 60_000;

const history = new Map(); // `${guildId}:${userId}` -> [{ content, timestamp }]

export const SPAM_REASON_LABELS = {
  flood: 'mensajes muy seguidos (flood)',
  duplicado: 'contenido repetido',
  mencion_masiva: 'menciones masivas',
};

export function detectSpam(message) {
  const mentionCount = message.mentions.users.size + message.mentions.roles.size;
  if (mentionCount >= MASS_MENTION_THRESHOLD) return 'mencion_masiva';

  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const entries = (history.get(key) ?? []).filter((e) => now - e.timestamp < DUPLICATE_WINDOW_MS);
  entries.push({ content: message.content, timestamp: now });
  history.set(key, entries);

  const floodCount = entries.filter((e) => now - e.timestamp < FLOOD_WINDOW_MS).length;
  if (floodCount >= FLOOD_THRESHOLD) {
    history.delete(key);
    return 'flood';
  }

  if (message.content.trim().length > 0) {
    const duplicateCount = entries.filter((e) => e.content === message.content).length;
    if (duplicateCount >= DUPLICATE_THRESHOLD) {
      history.delete(key);
      return 'duplicado';
    }
  }

  return null;
}

setInterval(() => {
  const cutoff = Date.now() - DUPLICATE_WINDOW_MS;
  for (const [key, entries] of history) {
    const fresh = entries.filter((e) => e.timestamp > cutoff);
    if (fresh.length === 0) history.delete(key);
    else history.set(key, fresh);
  }
}, CLEANUP_INTERVAL_MS).unref();
