// Store genérico de sesiones en memoria, con TTL. Lo usa /trivia (y, más adelante,
// cualquier otro mini-juego de una sola ronda que necesite guardar algo del lado del
// servidor entre "mostrar la pregunta" y "procesar la respuesta").
const sessions = new Map();
const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutos sin actividad = sesión vencida

export function getSession(key) {
  const session = sessions.get(key);
  if (!session) return null;
  if (Date.now() - session.updatedAt > SESSION_TTL_MS) {
    sessions.delete(key);
    return null;
  }
  return session;
}

export function startSession(key, secret) {
  sessions.set(key, { secret, attempts: 0, updatedAt: Date.now() });
}

export function clearSession(key) {
  sessions.delete(key);
}

// Barre sesiones vencidas cada 5 minutos. Sin esto, alguien que arranca una
// partida y nunca la termina queda ocupando memoria para siempre (el Map
// solo vive en RAM, no se limpia solo).
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions) {
    if (now - session.updatedAt > SESSION_TTL_MS) sessions.delete(key);
  }
}, 5 * 60 * 1000).unref();
