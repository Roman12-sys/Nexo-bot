// Config propia del dashboard — separada de src/config.js porque este proceso corre
// aparte del bot (otro servicio de Railway) y tiene variables que el bot no necesita
// (secreto OAuth, secreto de firma de sesión, URL pública propia).
import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta variable de entorno: ${name}`);
  return value;
}

// Auditoría 2026-09-12: required() solo chequeaba "no vacío" — un secreto corto
// configurado por error en Railway sería forjable por fuerza bruta offline contra la
// firma HMAC-SHA256 de session.js (el algoritmo/comparación ahí ya son correctos, el
// riesgo sería puramente un secreto débil). 32+ caracteres es el mínimo razonable para
// una clave HMAC-SHA256 — falla el arranque con un mensaje claro en vez de aceptar
// cualquier string no vacío.
function requiredSecret(name, minLength = 32) {
  const value = required(name);
  if (value.length < minLength) {
    throw new Error(`${name} es demasiado corto (${value.length} caracteres, mínimo ${minLength}) — generá uno nuevo más largo.`);
  }
  return value;
}

export const dashboardConfig = {
  clientSecret: required('CLIENT_SECRET'),
  sessionSecret: requiredSecret('DASHBOARD_SESSION_SECRET'),
  baseUrl: required('DASHBOARD_BASE_URL').replace(/\/$/, ''),
  port: process.env.PORT || 3000,
};
