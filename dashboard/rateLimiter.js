// Antiabuso mínimo por IP para las rutas del dashboard — mismo patrón en memoria que
// src/utils/rateLimiter.js (el del bot), pero por IP en vez de por userId de Discord:
// acá hay rutas que se pegan ANTES de tener sesión (/auth/login, /auth/callback), así
// que no siempre hay un userId todavía para usar como clave.
const MAX_REQUESTS = 60;
const WINDOW_MS = 60 * 1000;

const hits = new Map(); // ip -> timestamps[] dentro de la ventana actual

function clientIp(req) {
  // Railway (y cualquier proxy) entrega la IP real en X-Forwarded-For, no en
  // req.socket.remoteAddress (que sería la IP del proxy). Toma la primera de la
  // cadena, que es la del cliente original.
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

export function rateLimitMiddleware(req, res, next) {
  const ip = clientIp(req);
  const now = Date.now();
  const timestamps = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);

  if (timestamps.length >= MAX_REQUESTS) {
    hits.set(ip, timestamps);
    res.status(429).send('Demasiadas solicitudes. Esperá un momento e intentá de nuevo.');
    return;
  }

  timestamps.push(now);
  hits.set(ip, timestamps);
  next();
}

// Mismo criterio de limpieza que el rate limiter del bot: barrido periódico para que
// una IP que pegó una sola vez no quede ocupando una entrada del Map para siempre.
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of hits) {
    const fresh = timestamps.filter((t) => now - t < WINDOW_MS);
    if (fresh.length === 0) hits.delete(ip);
    else hits.set(ip, fresh);
  }
}, 5 * 60 * 1000).unref();
