// Antiabuso mínimo por IP para las rutas del dashboard — mismo patrón en memoria que
// src/utils/rateLimiter.js (el del bot), pero por IP en vez de por userId de Discord:
// acá hay rutas que se pegan ANTES de tener sesión (/auth/login, /auth/callback), así
// que no siempre hay un userId todavía para usar como clave.
const MAX_REQUESTS = 60;
const WINDOW_MS = 60 * 1000;

const hits = new Map(); // ip -> timestamps[] dentro de la ventana actual

// Railway pone exactamente UN proxy de borde propio entre internet y este proceso — no
// hay CDN ni load balancer intermedio propio nuestro delante de eso. Cualquier proxy
// estándar (el de Railway incluido) AGREGA (nunca reemplaza) al FINAL de
// X-Forwarded-For la IP de quien se conectó directo a él — nunca la reescribe. Como ese
// único hop es el único salto entre el cliente real e nuestro proceso, la ÚLTIMA entrada
// de la cadena es siempre la que agregó Railway a partir de la conexión TCP real, y es
// la única que un cliente NO puede falsificar (puede mandar su propio X-Forwarded-For
// con cualquier valor, pero eso termina a la IZQUIERDA de lo que Railway agregue al
// final). Tomar la PRIMERA entrada (como hacía antes) confiaba literalmente en un header
// que cualquiera puede setear con el valor que quiera — alcanzaba con mandar un
// X-Forwarded-For nuevo en cada request para resetear el límite a voluntad. Esto es el
// mismo criterio que "trust proxy: 1" en Express, implementado a mano para no depender
// de req.ip (que necesitaría los mocks de test replicando el cálculo interno de
// proxy-addr en vez de objetos req simples).
function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const parts = forwarded.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
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
