// Server-rendered plano (sin motor de templates ni frontend framework) — el dashboard
// es de solo lectura y de bajo tráfico, no justifica esa dependencia extra.
import { config } from '../src/config.js';
import { essentialPermissionsBitfield } from '../src/utils/botPermissions.js';
import {
  WEB_BG,
  WEB_BG_RAISED,
  WEB_SURFACE,
  WEB_BORDER,
  WEB_TEXT,
  WEB_TEXT_MUTED,
  WEB_BRAND,
  WEB_BRAND_SOFT,
  WEB_STATUS_OK,
  WEB_STATUS_WARN,
  WEB_STATUS_DANGER,
} from '../src/utils/webTheme.js';

const BRAND_COLOR = WEB_BRAND;

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

// H5-3, auditoría completa NEXO — el dashboard no tenía NINGÚN link legal (a diferencia
// del sitio, que sí los tenía, aunque hasta esta misma fase apuntaban a artifacts
// privados de claude.ai — ver website/pages/legal.js). Ambos condicionales por
// separado, nunca un link inventado: sin SUPPORT_CONTACT no hay línea de soporte; sin
// WEBSITE_BASE_URL no hay línea legal (recién ahí el dashboard sabe dónde vive el sitio
// real). El footer entero desaparece si ninguno de los dos está configurado, en vez de
// quedar vacío con solo el borde superior.
function buildFooter(wide = false) {
  const parts = [];
  if (config.supportContact) {
    parts.push(`<p class="muted">🆘 ¿Problemas con el bot? ${escapeHtml(config.supportContact)}</p>`);
  }
  if (config.websiteUrl) {
    parts.push(
      `<p class="muted">Legal: <a href="${escapeHtml(config.websiteUrl)}/legal/terminos" target="_blank" rel="noopener">Términos de servicio</a> · <a href="${escapeHtml(config.websiteUrl)}/legal/privacidad" target="_blank" rel="noopener">Política de privacidad</a></p>`,
    );
  }
  return parts.length > 0 ? `<footer${wide ? ' class="wide"' : ''}>${parts.join('')}</footer>` : '';
}

// `wide` amplía únicamente el contenedor de ESTA llamada a layout() (clase `.wide` en
// <main>/<footer>, ver CSS) — pensado para la pantalla de "Tus servidores" (mejora de
// composición, 2026-09-19), que tenía demasiado espacio vacío a los costados con el
// max-width angosto de siempre. El resto de páginas (login, dashboard de un servidor,
// errores) no pasan este flag y conservan el ancho de 880px sin cambios.
export function layout({ title, body, loggedIn = false, wide = false }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Nexo Bot</title>
<style>
  /* Auditoría UX/UI (2026-09-18): tokens :root, mismo patrón que website/layout.js —
     y con los MISMOS valores (import de src/utils/webTheme.js), en vez de la paleta
     "prima pero no idéntica" que este archivo tenía antes (fondo/borde con valores
     parecidos pero distintos a los del sitio, copiados a mano). */
  :root {
    color-scheme: dark;
    --bg: ${WEB_BG};
    --bg-raised: ${WEB_BG_RAISED};
    --surface: ${WEB_SURFACE};
    --border: ${WEB_BORDER};
    --text: ${WEB_TEXT};
    --text-muted: ${WEB_TEXT_MUTED};
    --brand: ${WEB_BRAND};
    --brand-soft: ${WEB_BRAND_SOFT};
    --status-ok: ${WEB_STATUS_OK};
    --status-warn: ${WEB_STATUS_WARN};
    --status-danger: ${WEB_STATUS_DANGER};
  }
  /* Tipografía (2026-09-19) — Manrope para headings, mismas 2 fuentes self-hosted que ya
     usa website/layout.js (src/assets/fonts/, servidas acá vía /fonts/*, sin duplicar
     archivos ni pegarle a Google Fonts) — el dashboard no tenía NINGÚN font-face propio
     antes de esto, solo la pila de sistema. El cuerpo del texto (tablas, párrafos) se
     queda con la pila de sistema a propósito, mismo criterio que ya usa el sitio: Manrope
     es para jerarquía visual (headings), no para bloques largos de texto/datos. */
  @font-face { font-family: 'Manrope'; src: url('/fonts/Manrope-SemiBold.ttf') format('truetype'); font-weight: 600; font-display: swap; }
  @font-face { font-family: 'Manrope'; src: url('/fonts/Manrope-Bold.ttf') format('truetype'); font-weight: 700; font-display: swap; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.55;
  }
  a { color: var(--brand-soft); }
  h1, h2, h3, h4 { font-family: 'Manrope', -apple-system, sans-serif; font-weight: 700; letter-spacing: -0.01em; }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    row-gap: 0.6rem;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid var(--border);
  }
  /* Mejora dashboard "Tus servidores" (2026-09-19) — jerarquía de marca en 2 líneas
     (NEXO / Dashboard) en vez de un solo renglón chico "Nexo Bot · Dashboard". Es
     parte del chrome compartido (header), así que aplica a todas las páginas, no solo
     a la de selección de servidor. */
  header .brand { display: flex; flex-direction: column; gap: 0.05rem; line-height: 1.15; text-decoration: none; }
  header .brand-name { font-family: 'Manrope', -apple-system, sans-serif; font-weight: 800; font-size: 1.2rem; color: var(--brand); letter-spacing: 0.01em; }
  header .brand-sub { font-weight: 600; font-size: 0.68rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.09em; }
  main { max-width: 880px; margin: 0 auto; padding: 2rem 1.5rem 4rem; }
  main.wide { max-width: 1160px; }
  h1 { font-size: 1.5rem; margin: 0 0 1.25rem; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 1.25rem 1.5rem; margin-bottom: 1.25rem; }
  .card h2 { margin-top: 0; font-size: 1.02rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.88rem; margin-top: 0.75rem; }
  th, td { text-align: left; padding: 0.45rem 0.6rem; border-bottom: 1px solid var(--border); }
  th { color: var(--text-muted); font-weight: 600; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.03em; }
  tbody tr:last-child td { border-bottom: none; }
  /* Pantalla "Tus servidores" (mejora de composición, 2026-09-19) — tarjetas
     seleccionables reales en vez de la lista de bloques tipo formulario que había
     antes (.guild-list/.guild-item). Estados normal/hover/foco-teclado/click
     distintos entre sí, sin colores nuevos: reusan --brand/--bg-raised ya definidos
     arriba + una sombra neutra (rgba negro) para la elevación en hover, nunca un
     "glow" de color de marca — evita introducir un valor rgba nuevo del violeta de
     marca solo para eso. */
  .servers-subtitle { margin: -1rem 0 1.75rem; color: var(--text-muted); font-size: 0.95rem; }
  .guild-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
  @media (max-width: 720px) { .guild-grid { grid-template-columns: 1fr; } }
  .guild-card {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1.1rem 1.25rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    text-decoration: none;
    color: inherit;
    transition: border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
  }
  .guild-card:hover { border-color: var(--brand); background: var(--bg-raised); box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3); transform: translateY(-2px); }
  .guild-card:focus-visible { outline: none; border-color: var(--brand); box-shadow: 0 0 0 2px var(--brand); }
  .guild-card:active { border-color: var(--brand); background: var(--bg-raised); box-shadow: 0 0 0 2px var(--brand); transform: translateY(0); }
  .guild-avatar, .guild-avatar-placeholder { width: 52px; height: 52px; border-radius: 50%; flex: none; object-fit: cover; }
  .guild-avatar-placeholder { display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, var(--brand), var(--brand-soft)); color: #fff; font-weight: 700; font-size: 1.1rem; }
  .guild-info { flex: 1; min-width: 0; }
  .guild-name { font-weight: 600; font-size: 1.02rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Servidores invitados sin /setup todavía (2026-09-19) — mismo componente de tarjeta,
     borde punteado en vez de sólido para leerse como "inactivo" a simple vista, sin
     inventar un color nuevo (reusa --border ya definido arriba). El badge en sí reusa
     .badge.badge-warning, ya definido más abajo para las tarjetas de "Sistemas". */
  .guild-card-pending { border-style: dashed; }
  .guild-status-pending { margin-top: 0.3rem; }
  .guild-cta { flex: none; font-size: 0.85rem; font-weight: 600; color: var(--text-muted); white-space: nowrap; transition: color 0.15s ease; }
  .guild-card:hover .guild-cta, .guild-card:focus-visible .guild-cta, .guild-card:active .guild-cta { color: var(--brand-soft); }
  .btn { display: inline-block; background: var(--brand); color: #fff; text-decoration: none; padding: 0.65rem 1.3rem; border-radius: 8px; font-weight: 600; transition: background-color 0.15s ease; }
  .btn:hover { background: var(--brand-soft); }
  .btn-sm { padding: 0.5rem 1rem; font-size: 0.85rem; }
  .muted { color: var(--text-muted); font-size: 0.85rem; text-decoration: none; }
  .stat-row { display: flex; gap: 1.75rem; flex-wrap: wrap; }
  .stat .value { font-size: 1.4rem; font-weight: 700; font-variant-numeric: tabular-nums; }
  .stat .label, .label { font-size: 0.74rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.03em; }
  .login-card { text-align: center; padding: 3rem 1.5rem; }
  .header-actions { display: flex; align-items: center; gap: 1rem; }
  footer { max-width: 880px; margin: 2.5rem auto 0; padding: 1.5rem 1.5rem 2rem; border-top: 1px solid var(--border); }
  footer.wide { max-width: 1160px; }
  footer p { margin: 0.3rem 0; }

  /* Dashboard 2.0 (MEJORA 1/2, CICLO 1) — resumen, acciones rápidas, estado de sistemas
     y problemas de configuración. Mismos tokens de color de arriba, nada nuevo. Los
     fondos tintados de cada badge (#123524 etc.) quedan como estaban a propósito — la
     auditoría UX/UI solo flageó el color de TEXTO/estado, no estos tintes de fondo. */
  /* Ícono SVG (2026-09-19, src/utils/webIcons.js) — se probó en TODO el dashboard y se
     revirtió a pedido explícito a favor de los emoji originales, salvo acá: el badge
     "Pendiente de configurar" de renderGuildList (pantalla "Tus servidores"), el único
     lugar donde se decidió dejarlo. Siempre pegado a texto visible, nunca solo. */
  .icon { display: inline-block; vertical-align: -0.15em; margin-right: 0.2em; flex: none; }
  .badge { display: inline-block; padding: 0.15rem 0.6rem; border-radius: 999px; font-size: 0.72rem; font-weight: 600; white-space: nowrap; }
  .badge-ok { background: #123524; color: var(--status-ok); }
  .badge-warning { background: #3a2f12; color: var(--status-warn); }
  .badge-off { background: #241f38; color: var(--text-muted); }
  .badge-danger { background: #3a1420; color: var(--status-danger); }
  .quick-actions { display: flex; flex-wrap: wrap; gap: 0.6rem; margin-top: 0.9rem; }
  .quick-actions a { background: var(--bg-raised); border: 1px solid var(--border); border-radius: 8px; padding: 0.5rem 0.85rem; font-size: 0.85rem; text-decoration: none; color: var(--text); }
  .quick-actions a:hover { border-color: var(--brand); }
  .issue-item { padding: 0.75rem 0; border-bottom: 1px solid var(--border); display: flex; gap: 0.75rem; align-items: flex-start; }
  .issue-item:last-child { border-bottom: none; }
  .issue-item .issue-body h4 { margin: 0 0 0.2rem; font-size: 0.92rem; }
  .issue-item .issue-body p { margin: 0; color: var(--text-muted); font-size: 0.85rem; }
  .systems-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 0.65rem; margin-top: 0.9rem; }
  .systems-grid .system-item { background: var(--bg-raised); border: 1px solid var(--border); border-radius: 8px; padding: 0.7rem 0.85rem; display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
  .activity-list { list-style: none; margin: 0.75rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
  .activity-list li { font-size: 0.85rem; color: var(--text); }
  .activity-list .muted { display: block; font-size: 0.78rem; }

  /* Barra de carga arriba (2026-09-19, reemplaza el overlay a pantalla completa de la
     primera versión — pedido explícito: algo como la barrita nativa de carga del
     navegador, estilo YouTube/GitHub, no un bloqueo de pantalla completa). /guild/:id
     dispara ~22 fuentes de datos con concurrencia 6 (loadGuildDashboardData) y puede
     tardar varios segundos — sin esto, el click sobre una tarjeta de "Tus servidores" se
     sentía como que no pasó nada hasta que el navegador terminaba de cargar la página
     siguiente. No hay forma de acortar ese tiempo real desde acá (es trabajo de red/
     Supabase, no de presentación); esto da feedback inmediato (0ms) en vez de dejar la
     página vieja quieta durante la espera. El avance (20% al toque, después una curva
     que se acerca a 90% sin llegar nunca) es el mismo truco que usa NProgress — nunca se
     completa al 100% desde acá porque no hay forma real de saber cuánto falta; el 100%
     real lo pone el propio navegador al reemplazar la página entera por la siguiente. */
  .page-loading-bar {
    position: fixed; top: 0; left: 0; height: 3px; width: 0%; z-index: 9999;
    background: linear-gradient(90deg, var(--brand), var(--brand-soft));
    box-shadow: 0 0 8px 0 var(--brand);
    opacity: 0;
    transition: width 0.25s ease, opacity 0.2s ease;
  }
  .page-loading-bar.is-active { opacity: 1; }

  /* Skeleton de carga (2026-09-19) — junto con la barra de arriba, reemplaza el
     contenido real de <main> por bloques placeholder apenas se clickea un link interno,
     mismo patrón que YouTube/LinkedIn/Facebook (Ley de Jakob: nadie tiene que aprender a
     leer esto). Genérico a propósito — no imita el layout EXACTO de la página destino
     (nunca se sabe cuál es hasta que termina de cargar), solo transmite "esto va a
     mostrar tarjetas de datos en un momento". El HTML real de <main> se guarda antes de
     reemplazarlo y se restaura si la navegación no llega a completarse (ver el script). */
  .skeleton-title { height: 28px; width: 40%; margin-bottom: 1.5rem; }
  .skeleton-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 1.25rem 1.5rem; margin-bottom: 1.25rem; }
  .skeleton-line { height: 14px; border-radius: 6px; margin-bottom: 0.65rem; }
  .skeleton-line:last-child { margin-bottom: 0; }
  .skeleton-block {
    background: linear-gradient(90deg, var(--bg-raised) 25%, var(--surface) 37%, var(--bg-raised) 63%);
    background-size: 400% 100%;
    animation: skeleton-shimmer 1.4s ease infinite;
  }
  @keyframes skeleton-shimmer { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }
  @media (prefers-reduced-motion: reduce) { .skeleton-block { animation: none; background: var(--bg-raised); } }
</style>
</head>
<body>
<div class="page-loading-bar" id="page-loading-bar" role="progressbar" aria-hidden="true"></div>
<header>
  <a class="brand" href="/">
    <span class="brand-name">NEXO</span>
    <span class="brand-sub">Dashboard</span>
  </a>
  <div class="header-actions">
    <a class="btn btn-sm" href="${buildInviteUrl()}" target="_blank" rel="noopener">+ Invitar servidor</a>
    ${loggedIn ? '<a class="muted" href="/auth/logout">Cerrar sesión</a>' : ''}
  </div>
</header>
<main${wide ? ' class="wide"' : ''}>${body}</main>
${buildFooter(wide)}
<script>
(function () {
  var bar = document.getElementById('page-loading-bar');
  if (!bar) return;
  var main = document.querySelector('main');
  // Contenido REAL de esta carga, guardado una sola vez al inicio — si la navegación
  // arranca (start() reemplaza esto por el skeleton) pero nunca llega a completarse
  // (usuario cancela, bfcache raro), reset() lo restaura tal cual estaba.
  var originalMainHtml = main ? main.innerHTML : '';
  var tickTimer = null;
  var safetyTimer = null;
  var width = 0;

  function skeletonCard(lineWidths) {
    var lines = lineWidths.map(function (w) { return '<div class="skeleton-block skeleton-line" style="width:' + w + '"></div>'; }).join('');
    return '<div class="skeleton-card">' + lines + '</div>';
  }

  // Genérico a propósito (ver el comentario de .skeleton-card en el <style>) — 3
  // tarjetas con anchos de línea variados, ni una réplica exacta de ninguna página real.
  function buildSkeletonHtml() {
    return (
      '<div class="skeleton-block skeleton-title"></div>' +
      skeletonCard(['35%', '100%', '90%']) +
      skeletonCard(['45%', '100%', '80%', '60%']) +
      skeletonCard(['30%', '100%', '100%', '70%'])
    );
  }

  function reset() {
    clearInterval(tickTimer);
    clearTimeout(safetyTimer);
    // Solo tocar el DOM de <main> si de verdad había un skeleton puesto — reset() corre
    // también en CADA pageshow (incluida una carga fresca normal, donde nunca se llegó a
    // llamar start()), y ahí main.innerHTML ya es el real: reescribirlo sería una
    // reflow/repaint inútil, no un bug visible, pero tampoco gratis.
    if (bar.classList.contains('is-active') && main) main.innerHTML = originalMainHtml;
    bar.classList.remove('is-active');
    bar.style.width = '0%';
  }

  function start() {
    reset();
    width = 20; // salto inicial visible al toque, no arranca de 0 imperceptible
    bar.style.width = width + '%';
    bar.classList.add('is-active');
    // Se acerca a 90% sin llegar nunca — mismo truco que NProgress. No hay forma de
    // saber desde acá cuánto falta de verdad (loadGuildDashboardData no reporta
    // progreso parcial); el 100% real lo pone el propio navegador al reemplazar esta
    // página entera por la siguiente, nunca este script.
    tickTimer = setInterval(function () {
      width += (90 - width) * 0.1;
      bar.style.width = width + '%';
    }, 200);
    if (main) main.innerHTML = buildSkeletonHtml();
    // Red de seguridad: si la navegación nunca llega a completarse (el usuario cancela
    // la carga, un bfcache raro), ni la barra ni el skeleton deben quedar para siempre.
    safetyTimer = setTimeout(reset, 15000);
  }

  // Solo links de navegación REAL dentro del propio dashboard — nunca los target="_blank"
  // (invitar, abrir servidor en Discord, soporte, legal) ni anclas de la misma página
  // (#config, #economia, etc. — no navegan a ningún lado, no hay nada que esperar).
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest('a');
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    var href = a.getAttribute('href') || '';
    if (!href.startsWith('/')) return; // externo, o ancla "#..."
    start();
  });
  // pageshow cubre tanto una carga fresca (la barra ya nace en 0% en el HTML servido)
  // como una restauración de bfcache (volver con el botón "Atrás") — en los dos casos
  // hay que resetear por si había quedado a mitad de camino.
  window.addEventListener('pageshow', reset);
})();
</script>
</body>
</html>`;
}
