import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta variable de entorno: ${name}`);
  return value;
}

export const config = {
  discordToken: required('DISCORD_TOKEN'),
  clientId: required('CLIENT_ID'),
  guildIdDev: process.env.GUILD_ID_DEV || null,
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  // Canal de un servidor propio de operación (no un guild de cliente, no guild_config)
  // donde reportCriticalError (errorReporter.js) manda alertas de fallas reales.
  // Opcional a propósito: sin configurar, el bot arranca igual y reportCriticalError
  // simplemente no manda nada — no es un requisito de boot, es un canal operativo.
  operatorAlertChannelId: process.env.OPERATOR_ALERT_CHANNEL_ID || null,
  // Dónde puede un cliente pedir ayuda (link de invite a un server de soporte, canal,
  // email) — COM-3, Fase 4B. Sin valor real todavía: se deja sin completar a propósito
  // (no inventar una URL) hasta que se defina cuál es el canal de soporte real. `/help`
  // y el dashboard lo muestran SOLO si está configurado — nunca un link roto/inventado.
  supportContact: process.env.SUPPORT_CONTACT || null,
  // URL pública del dashboard (Fase 4C-1) — dashboard/config.js la exige para arrancar
  // ESE proceso; acá es opcional a propósito, el bot no la necesita para nada excepto
  // mostrarle el link al admin al final de /setup (onboarding). Mismo nombre de variable
  // que dashboard/config.js: es el mismo valor conceptual, pero son dos servicios
  // separados de Railway con sus propias variables — no se inventa un nombre nuevo para
  // lo mismo. Sin configurar en este servicio, /setup simplemente no menciona el
  // dashboard (nunca un link inventado).
  dashboardUrl: process.env.DASHBOARD_BASE_URL ? process.env.DASHBOARD_BASE_URL.replace(/\/$/, '') : null,
};
