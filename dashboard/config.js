// Config propia del dashboard — separada de src/config.js porque este proceso corre
// aparte del bot (otro servicio de Railway) y tiene variables que el bot no necesita
// (secreto OAuth, secreto de firma de sesión, URL pública propia).
import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta variable de entorno: ${name}`);
  return value;
}

export const dashboardConfig = {
  clientSecret: required('CLIENT_SECRET'),
  sessionSecret: required('DASHBOARD_SESSION_SECRET'),
  baseUrl: required('DASHBOARD_BASE_URL').replace(/\/$/, ''),
  port: process.env.PORT || 3000,
};
