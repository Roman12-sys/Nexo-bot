// Server-rendered plano (sin motor de templates ni frontend framework) — el dashboard
// es de solo lectura y de bajo tráfico, no justifica esa dependencia extra.
import { config } from '../src/config.js';
import { essentialPermissionsBitfield } from '../src/utils/botPermissions.js';

const BRAND_COLOR = '#7F5AF0';

// DASH-1, Fase 4B: antes no había NINGÚN link para invitar al bot a otro servidor en
// todo el dashboard. Se arma con el client_id real del proyecto (config.clientId, el
// mismo que usa src/deploy-commands.js).
//
// QUÉ CAMBIÓ (Fase 4C-1, guía de permisos): se agregó `permissions=` con el bitfield de
// ESSENTIAL_BOT_PERMISSIONS (src/utils/botPermissions.js, la MISMA lista que /setup y
// /estado usan para detectar qué falta). Antes se dejaba el link sin ningún permiso
// pre-tildado a propósito ("que la pantalla de consentimiento de Discord sea la que
// pida") — pero la auditoría de producto encontró que eso es justo lo que hacía fácil
// que un admin destildara sin querer algo que el bot necesita. Discord igual deja
// desmarcar cualquiera de estos en esa pantalla; esto solo mejora el default.
function buildInviteUrl() {
  return `https://discord.com/oauth2/authorize?client_id=${config.clientId}&scope=bot+applications.commands&permissions=${essentialPermissionsBitfield()}`;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function layout({ title, body, loggedIn = false }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Nexo Bot</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0c0a14;
    color: #ede9f7;
    line-height: 1.55;
  }
  a { color: #a284f7; }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid #2c2645;
  }
  header .brand { font-weight: 700; color: ${BRAND_COLOR}; text-decoration: none; font-size: 1.05rem; }
  main { max-width: 880px; margin: 0 auto; padding: 2rem 1.5rem 4rem; }
  h1 { font-size: 1.5rem; margin: 0 0 1.25rem; }
  .card { background: #15121f; border: 1px solid #2c2645; border-radius: 12px; padding: 1.25rem 1.5rem; margin-bottom: 1.25rem; }
  .card h2 { margin-top: 0; font-size: 1.02rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.88rem; margin-top: 0.75rem; }
  th, td { text-align: left; padding: 0.45rem 0.6rem; border-bottom: 1px solid #2c2645; }
  th { color: #978fb4; font-weight: 600; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.03em; }
  tbody tr:last-child td { border-bottom: none; }
  .guild-list { display: flex; flex-direction: column; gap: 0.6rem; }
  .guild-item { display: flex; align-items: center; gap: 0.9rem; padding: 0.8rem 1rem; background: #15121f; border: 1px solid #2c2645; border-radius: 10px; text-decoration: none; color: inherit; }
  .guild-item:hover { border-color: ${BRAND_COLOR}; }
  .guild-icon, .guild-icon-placeholder { width: 40px; height: 40px; border-radius: 50%; flex: none; }
  .guild-icon-placeholder { background: #2c2645; }
  .btn { display: inline-block; background: ${BRAND_COLOR}; color: #fff; text-decoration: none; padding: 0.65rem 1.3rem; border-radius: 8px; font-weight: 600; }
  .muted { color: #978fb4; font-size: 0.85rem; text-decoration: none; }
  .stat-row { display: flex; gap: 1.75rem; flex-wrap: wrap; }
  .stat .value { font-size: 1.4rem; font-weight: 700; font-variant-numeric: tabular-nums; }
  .stat .label { font-size: 0.74rem; color: #978fb4; text-transform: uppercase; letter-spacing: 0.03em; }
  .login-card { text-align: center; padding: 3rem 1.5rem; }
  .header-actions { display: flex; align-items: center; gap: 1rem; }
  footer { max-width: 880px; margin: 0 auto; padding: 0 1.5rem 2rem; }
</style>
</head>
<body>
<header>
  <a class="brand" href="/">📊 Nexo Bot · Dashboard</a>
  <div class="header-actions">
    <a class="muted" href="${buildInviteUrl()}" target="_blank" rel="noopener">+ Invitar a otro servidor</a>
    ${loggedIn ? '<a class="muted" href="/auth/logout">Cerrar sesión</a>' : ''}
  </div>
</header>
<main>${body}</main>
${config.supportContact ? `<footer><p class="muted">🆘 ¿Problemas con el bot? ${escapeHtml(config.supportContact)}</p></footer>` : ''}
</body>
</html>`;
}
