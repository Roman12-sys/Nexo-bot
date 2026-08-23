// Rastrea /give recientes en memoria para detectar patrones sospechosos (lavado de
// monedas entre cuentas, distribución masiva desde una cuenta comprometida). Mismo
// patrón que guessSessions.js: Map en RAM, self-expiring, nunca pasa a Supabase porque
// es señal de comportamiento reciente, no un dato de negocio que deba persistir.

const WINDOW_MS = 10 * 60 * 1000; // ventana de 10 minutos
const REPEAT_THRESHOLD = 3; // mismo receptor 3+ veces en la ventana
const FANOUT_THRESHOLD = 5; // 5+ receptores distintos en la ventana

const givesBySender = new Map(); // key: `${guildId}:${senderId}` -> [{ receiverId, amount, ts }]

// Registra una transferencia y devuelve un patrón sospechoso si se acaba de cruzar
// un umbral (=== , no >=, para avisar una sola vez por racha en vez de en cada /give
// subsiguiente — eso sería justo el ruido que no queremos).
export function recordGive(guildId, senderId, receiverId, amount) {
  const key = `${guildId}:${senderId}`;
  const now = Date.now();

  const entries = (givesBySender.get(key) || []).filter((e) => now - e.ts < WINDOW_MS);
  entries.push({ receiverId, amount, ts: now });
  givesBySender.set(key, entries);

  const toSameReceiver = entries.filter((e) => e.receiverId === receiverId);
  if (toSameReceiver.length === REPEAT_THRESHOLD) {
    return {
      pattern: 'repeat',
      receiverId,
      count: toSameReceiver.length,
      totalAmount: toSameReceiver.reduce((sum, e) => sum + e.amount, 0),
      windowMinutes: WINDOW_MS / 60000,
    };
  }

  const distinctReceivers = new Set(entries.map((e) => e.receiverId));
  if (distinctReceivers.size === FANOUT_THRESHOLD) {
    return {
      pattern: 'fanout',
      receiverIds: [...distinctReceivers],
      count: entries.length,
      windowMinutes: WINDOW_MS / 60000,
    };
  }

  return null;
}

// Barre entradas vencidas cada 5 minutos, igual que guessSessions.js.
setInterval(() => {
  const now = Date.now();
  for (const [key, entries] of givesBySender) {
    const fresh = entries.filter((e) => now - e.ts < WINDOW_MS);
    if (fresh.length === 0) givesBySender.delete(key);
    else givesBySender.set(key, fresh);
  }
}, 5 * 60 * 1000).unref();
