// Config propia del sitio — proceso Express separado del bot Y del dashboard (3er
// servicio de Railway sobre el mismo repo). A propósito NO importa src/config.js: ese
// módulo exige DISCORD_TOKEN/SUPABASE_SERVICE_ROLE_KEY al importarse, y el sitio público
// (marketing, sin login propio, sin lectura de Supabase) no tiene ninguna razón para
// tener esos secrets en memoria — reduce el radio de daño de cualquier vulnerabilidad en
// esta app a "se puede desfigurar la landing", nunca "se filtró el token del bot o el
// service_role key de la base". CLIENT_ID es público (viaja tal cual en la URL de invite
// que cualquiera puede ver en el navegador) — no hay problema en exigirlo acá también.
import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta variable de entorno: ${name}`);
  return value;
}

export const websiteConfig = {
  clientId: required('CLIENT_ID'),
  // Mismo nombre de variable que dashboard/config.js y src/config.js (Fase 4C-1: "mismo
  // valor conceptual, mismo nombre en los 3 servicios") — opcional acá: sin ella, el CTA
  // "Iniciar sesión"/"Abrir Dashboard" del sitio no se muestra (nunca un link inventado).
  dashboardUrl: process.env.DASHBOARD_BASE_URL ? process.env.DASHBOARD_BASE_URL.replace(/\/$/, '') : null,
  supportContact: process.env.SUPPORT_CONTACT || null,
  // Dominio público de ESTE sitio (para canonical/OG/sitemap). UNKNOWN hasta que el
  // usuario lo confirme — sin esto, esas URLs quedan relativas en vez de inventar un
  // dominio (ver CLAUDE.md, regla del proyecto: nunca inventar infraestructura).
  siteUrl: process.env.WEBSITE_BASE_URL ? process.env.WEBSITE_BASE_URL.replace(/\/$/, '') : null,
  // Puerto propio en local (3000 lo usa el dashboard) para poder correr los 3 procesos a
  // la vez sin pisarse; en Railway, PORT lo inyecta la plataforma igual que a los otros 2.
  port: process.env.PORT || 3100,
};
