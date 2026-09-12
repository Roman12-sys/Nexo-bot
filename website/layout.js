// Shell HTML compartido del sitio — mismo criterio que dashboard/html.js: server-rendered
// plano, sin motor de templates ni framework de frontend (sitio mayormente estático, no
// lo justifica). Todo el CSS vive en un solo <style> embebido a propósito: sin build step,
// un solo archivo que servir, cero requests extra — si el sitio crece en fases futuras y
// esto se vuelve difícil de navegar, ahí sí vale la pena partirlo, no antes.
import { websiteConfig } from './config.js';
import { essentialPermissionsBitfield } from '../src/utils/botPermissions.js';
import { BRAND_NAME } from '../src/utils/embeds.js';

const BRAND_COLOR = '#7F5AF0'; // mismo valor que src/utils/embeds.js y dashboard/html.js — no hay un segundo color de marca en el proyecto.
const BRAND_COLOR_SOFT = '#a284f7';

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Mismo builder de invite que dashboard/html.js (scope + permissions bitfield real) —
// duplicado a propósito en vez de importado desde ahí: dashboard/html.js no exporta esta
// función, y el sitio no debería importar módulos internos del dashboard (son 2 procesos
// separados). La fuente de los permisos (ESSENTIAL_BOT_PERMISSIONS) sí es una única
// función pura reusada de src/utils/botPermissions.js.
export function buildInviteUrl() {
  return `https://discord.com/oauth2/authorize?client_id=${websiteConfig.clientId}&scope=bot+applications.commands&permissions=${essentialPermissionsBitfield()}`;
}

export function buildDashboardLoginUrl() {
  return websiteConfig.dashboardUrl ? `${websiteConfig.dashboardUrl}/auth/login` : null;
}

// Favicon como SVG inline (data URI) — no hay ningún logo en el repo (verificado: cero
// archivos de imagen fuera de las 2 fuentes .ttf), así que se construye un wordmark
// tipográfico simple ("N", color de marca real) en vez de inventar un ícono gráfico.
const FAVICON_SVG = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='16' fill='${BRAND_COLOR}'/><text x='32' y='44' font-family='Arial,sans-serif' font-weight='700' font-size='34' fill='white' text-anchor='middle'>N</text></svg>`;
const FAVICON_HREF = `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}`;

const GLOBAL_STYLES = `
  @font-face { font-family: 'Manrope'; src: url('/fonts/Manrope-SemiBold.ttf') format('truetype'); font-weight: 600; font-display: swap; }
  @font-face { font-family: 'Manrope'; src: url('/fonts/Manrope-Bold.ttf') format('truetype'); font-weight: 700; font-display: swap; }

  :root {
    color-scheme: dark;
    --bg: #0a0912;
    --bg-raised: #12101c;
    --surface: #15121f;
    --border: #2a2440;
    --text: #ede9f7;
    --text-muted: #978fb4;
    /* #756e91 (valor original) daba 4.14:1 contra --bg y hasta 3.86:1 contra --surface —
       por debajo del mínimo WCAG AA (4.5:1) para texto de tamaño normal, y este color se
       usa en textos chicos (badges, labels, fechas) que NO califican como "texto grande"
       (18px+ o 14px+ negrita) para bajar el umbral a 3:1. Encontrado y corregido en la
       revisión de accesibilidad de Fase 5 (medido con la fórmula de luminancia relativa
       de WCAG, no a ojo). #837b9f dobla el margen: 5.00:1 / 4.66:1 / 4.75:1 contra
       --bg/--surface/--bg-raised respectivamente — sigue leyéndose más apagado que
       --text-muted, pero ya no falla el mínimo en ningún fondo real del sitio. */
    --text-dim: #837b9f;
    --brand: ${BRAND_COLOR};
    --brand-soft: ${BRAND_COLOR_SOFT};
    --radius: 14px;
    --radius-sm: 9px;
    --max-width: 1180px;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  h1, h2, h3, .font-display { font-family: 'Manrope', -apple-system, sans-serif; font-weight: 700; letter-spacing: -0.01em; }
  a { color: inherit; }
  img, svg { max-width: 100%; }
  .wrap { max-width: var(--max-width); margin: 0 auto; padding: 0 1.5rem; }
  .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }
  a.skip-link { position: absolute; left: 1rem; top: -3rem; background: var(--brand); color: #fff; padding: 0.6rem 1rem; border-radius: 8px; z-index: 200; transition: top .15s ease; }
  a.skip-link:focus { top: 1rem; }
  :focus-visible { outline: 2px solid var(--brand-soft); outline-offset: 2px; }

  /* Navbar */
  header.site-nav {
    position: sticky; top: 0; z-index: 100;
    background: rgba(10, 9, 18, 0.82);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--border);
  }
  .nav-inner { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.9rem 1.5rem; max-width: var(--max-width); margin: 0 auto; }
  .nav-brand { font-family: 'Manrope', sans-serif; font-weight: 700; font-size: 1.15rem; text-decoration: none; color: var(--text); display: flex; align-items: center; gap: 0.5rem; }
  .nav-brand .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--brand); }
  nav.nav-links { display: flex; gap: 1.75rem; }
  nav.nav-links a { text-decoration: none; color: var(--text-muted); font-size: 0.92rem; font-weight: 500; transition: color .15s ease; }
  nav.nav-links a:hover { color: var(--text); }
  .nav-actions { display: flex; align-items: center; gap: 0.75rem; }
  .nav-toggle {
    display: none; background: transparent; border: 1px solid var(--border); border-radius: 8px;
    color: var(--text); width: 38px; height: 38px; align-items: center; justify-content: center;
    cursor: pointer; font-size: 1.1rem;
  }

  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem; text-decoration: none; font-weight: 600; border-radius: 10px; border: 1px solid transparent; cursor: pointer; font-size: 0.92rem; padding: 0.7rem 1.35rem; transition: transform .15s ease, background .15s ease, border-color .15s ease; }
  .btn:hover { transform: translateY(-1px); }
  .btn-primary { background: var(--brand); color: #fff; }
  .btn-primary:hover { background: #6c46e0; }
  .btn-ghost { background: transparent; color: var(--text); border-color: var(--border); }
  .btn-ghost:hover { border-color: var(--brand-soft); }
  .btn-sm { padding: 0.5rem 1rem; font-size: 0.85rem; }
  .btn-block { width: 100%; }

  /* Sections */
  section { padding: 5.5rem 0; }
  section.tight { padding: 3.5rem 0; }
  .eyebrow { display: inline-block; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--brand-soft); margin-bottom: 0.9rem; }
  .section-head { max-width: 640px; margin: 0 auto 3rem; text-align: center; }
  .section-head h1, .section-head h2 { font-size: clamp(1.6rem, 3vw, 2.1rem); margin: 0 0 0.85rem; }
  .section-head p { color: var(--text-muted); font-size: 1.02rem; margin: 0; }

  /* Hero */
  .hero { padding: 5rem 0 4rem; position: relative; overflow: hidden; }
  .hero::before {
    content: ''; position: absolute; inset: -20% -10% auto -10%; height: 480px;
    background: radial-gradient(ellipse at top, rgba(127,90,240,0.22), transparent 65%);
    pointer-events: none;
  }
  .hero-grid { display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 3.5rem; align-items: center; position: relative; }
  .hero h1 { font-size: clamp(2.4rem, 5vw, 3.6rem); line-height: 1.08; margin: 0 0 1.15rem; }
  .hero h1 span { display: block; }
  .hero h1 span.accent { color: var(--brand-soft); }
  .hero-sub { font-size: 1.1rem; color: var(--text-muted); max-width: 46ch; margin: 0 0 2rem; }
  .hero-ctas { display: flex; gap: 0.85rem; flex-wrap: wrap; margin-bottom: 1.6rem; }
  .hero-meta { color: var(--text-dim); font-size: 0.85rem; }
  .hero-meta strong { color: var(--text-muted); font-weight: 600; }

  /* Preview del dashboard (mock, no captura real) */
  .preview-frame { position: relative; }
  .preview-label { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.72rem; color: var(--text-dim); margin-bottom: 0.6rem; text-transform: uppercase; letter-spacing: 0.06em; }
  .preview-label .dot-live { width: 6px; height: 6px; border-radius: 50%; background: var(--text-dim); }
  .mock-dashboard { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; box-shadow: 0 30px 80px -30px rgba(0,0,0,0.6); }
  .mock-titlebar { display: flex; align-items: center; gap: 0.5rem; padding: 0.7rem 1rem; border-bottom: 1px solid var(--border); background: var(--bg-raised); }
  .mock-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--border); }
  .mock-titlebar span.mock-url { margin-left: 0.5rem; font-size: 0.72rem; color: var(--text-dim); }
  .mock-body { padding: 1.1rem; display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.7rem; }
  .mock-tile { background: var(--bg-raised); border: 1px solid var(--border); border-radius: 10px; padding: 0.85rem; }
  .mock-tile .mock-label { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-dim); }
  .mock-tile .mock-value { font-size: 1.25rem; font-weight: 700; margin-top: 0.25rem; font-variant-numeric: tabular-nums; }
  .mock-row { grid-column: 1 / -1; background: var(--bg-raised); border: 1px solid var(--border); border-radius: 10px; padding: 0.85rem 1rem; display: flex; justify-content: space-between; align-items: center; font-size: 0.82rem; color: var(--text-muted); }
  .mock-row .badge-ok { color: #4ade80; font-weight: 600; }

  /* Diagrama "Qué es NEXO" */
  .diagram { max-width: 760px; margin: 0 auto; }
  .diagram-branches { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 0; }
  .diagram-node { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 1.1rem 1rem; text-align: center; }
  .diagram-node .node-title { font-weight: 700; font-size: 0.98rem; }
  .diagram-node .node-sub { font-size: 0.82rem; color: var(--text-muted); margin-top: 0.3rem; }
  .diagram-connector { width: 2px; height: 28px; background: var(--border); margin: 0 auto; }
  .diagram-root, .diagram-final {
    text-align: center; font-family: 'Manrope', sans-serif; font-weight: 700; color: var(--brand-soft);
    background: var(--bg-raised); border: 1px solid var(--border); border-radius: 999px;
    padding: 0.7rem 1.6rem; display: inline-block; margin: 0 auto; font-size: 0.95rem;
  }
  .diagram-center { text-align: center; }

  /* Feature grid */
  .feature-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
  .feature-card {
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 1.4rem; text-align: left; cursor: pointer; color: inherit; font: inherit;
    transition: border-color .15s ease, transform .15s ease; display: flex; flex-direction: column; gap: 0.55rem;
  }
  .feature-card:hover, .feature-card[aria-pressed="true"] { border-color: var(--brand-soft); transform: translateY(-2px); }
  .feature-card .f-emoji { font-size: 1.5rem; }
  .feature-card .f-name { font-family: 'Manrope', sans-serif; font-weight: 700; font-size: 1.02rem; }
  .feature-card .f-tagline { color: var(--text-muted); font-size: 0.86rem; margin: 0; flex-grow: 1; }
  .feature-card .f-count { font-size: 0.75rem; color: var(--text-dim); font-weight: 600; }

  .feature-detail {
    margin-top: 1.75rem; background: var(--bg-raised); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 1.75rem; display: none;
  }
  .feature-detail.is-active { display: block; animation: fade-in .2s ease; }
  @media (prefers-reduced-motion: reduce) { .feature-detail.is-active { animation: none; } }
  .feature-detail h3 { margin: 0 0 0.6rem; font-size: 1.25rem; }
  .feature-detail p.f-description { color: var(--text-muted); margin: 0 0 1.1rem; max-width: 62ch; }
  .command-chip-row { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .command-chip { background: var(--surface); border: 1px solid var(--border); border-radius: 7px; padding: 0.35rem 0.7rem; font-size: 0.82rem; font-family: 'SFMono-Regular', Consolas, monospace; color: var(--brand-soft); }
  @keyframes fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

  /* /commands */
  .cmd-search-row { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; }
  .cmd-search {
    flex: 1; min-width: 220px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
    padding: 0.75rem 1rem; color: var(--text); font-size: 0.95rem; font-family: inherit;
  }
  .cmd-search::placeholder { color: var(--text-dim); }
  .cmd-search:focus { outline: none; border-color: var(--brand-soft); }
  .cmd-count { color: var(--text-dim); font-size: 0.82rem; white-space: nowrap; }
  .chip-row { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 2rem; }
  .chip {
    background: var(--surface); border: 1px solid var(--border); border-radius: 999px; color: var(--text-muted);
    padding: 0.45rem 0.9rem; font-size: 0.82rem; font-weight: 600; cursor: pointer; font-family: inherit;
  }
  .chip:hover { border-color: var(--brand-soft); color: var(--text); }
  .chip.is-active { background: var(--brand); border-color: var(--brand); color: #fff; }
  .cmd-list { display: flex; flex-direction: column; gap: 0.6rem; }
  .cmd-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
  .cmd-summary {
    width: 100%; display: grid; grid-template-columns: 9rem 1fr auto; gap: 1rem; align-items: center;
    background: transparent; border: none; color: inherit; text-align: left; padding: 0.9rem 1.1rem;
    cursor: pointer; font: inherit;
  }
  .cmd-name { font-family: 'SFMono-Regular', Consolas, monospace; color: var(--brand-soft); font-weight: 700; font-size: 0.92rem; }
  .cmd-desc { color: var(--text-muted); font-size: 0.88rem; }
  .cmd-badge { font-size: 0.74rem; color: var(--text-dim); white-space: nowrap; }
  .cmd-detail { display: none; padding: 0 1.1rem 1.1rem; border-top: 1px solid var(--border); }
  .cmd-card.is-open .cmd-detail { display: block; padding-top: 0.9rem; }
  .opt-list { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 0.8rem; }
  .opt-row { font-size: 0.85rem; display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: baseline; }
  .opt-sub { flex-direction: column; align-items: flex-start; background: var(--bg-raised); border-radius: 8px; padding: 0.6rem 0.7rem; }
  .opt-name { font-family: 'SFMono-Regular', Consolas, monospace; color: var(--text); font-weight: 600; }
  .opt-required { color: var(--brand-soft); margin-left: 0.15rem; }
  .opt-type { color: var(--text-dim); font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.03em; }
  .opt-desc { color: var(--text-muted); }
  .cmd-meta-line { color: var(--text-dim); font-size: 0.8rem; margin: 0.3rem 0 0; }
  .cmd-empty { text-align: center; color: var(--text-dim); padding: 2rem 0; }

  /* Todo conectado */
  .connected-stack { display: flex; flex-direction: column; align-items: center; gap: 0; max-width: 420px; margin: 0 auto; }
  .connected-layer { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.6rem; width: 100%; }
  .connected-pill { background: var(--surface); border: 1px solid var(--border); border-radius: 999px; text-align: center; padding: 0.55rem 0.4rem; font-size: 0.8rem; font-weight: 600; }

  /* Dashboard section */
  .split { display: grid; grid-template-columns: 1fr 1fr; gap: 3rem; align-items: center; }
  .split.reverse { direction: rtl; } .split.reverse > * { direction: ltr; }
  .check-list { list-style: none; margin: 1.4rem 0; padding: 0; display: flex; flex-direction: column; gap: 0.65rem; }
  .check-list li { display: flex; gap: 0.6rem; align-items: flex-start; color: var(--text-muted); font-size: 0.95rem; }
  .check-list li::before { content: '✓'; color: var(--brand-soft); font-weight: 700; flex-shrink: 0; }

  /* Para quién */
  .audience-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.1rem; }
  .audience-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.5rem; }
  .audience-card h3 { margin: 0 0 0.5rem; font-size: 1.05rem; }
  .audience-card p { color: var(--text-muted); font-size: 0.9rem; margin: 0 0 1rem; }
  .audience-card ul { margin: 0; padding-left: 1.1rem; color: var(--text-muted); font-size: 0.87rem; display: flex; flex-direction: column; gap: 0.35rem; }

  /* Stats */
  .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; text-align: center; }
  .stat-block .stat-num { font-family: 'Manrope', sans-serif; font-size: clamp(2rem, 4vw, 2.6rem); font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; }
  .stat-block .stat-label { color: var(--text-muted); font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 0.35rem; }

  /* Trust / seguridad */
  .trust-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; }
  .trust-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.4rem; }
  .trust-card h3 { margin: 0 0 0.5rem; font-size: 1rem; display: flex; align-items: center; gap: 0.5rem; }
  .trust-card p { color: var(--text-muted); font-size: 0.88rem; margin: 0; }

  /* CTA final */
  .cta-band { background: linear-gradient(180deg, var(--bg-raised), var(--surface)); border: 1px solid var(--border); border-radius: 20px; padding: 3.2rem 2rem; text-align: center; }
  .cta-band h2 { margin: 0 0 0.7rem; font-size: clamp(1.5rem, 3vw, 2rem); }
  .cta-band p { color: var(--text-muted); margin: 0 0 1.6rem; }

  /* /docs */
  .docs-layout { display: grid; grid-template-columns: 220px 1fr; gap: 3rem; align-items: start; }
  .docs-sidebar { position: sticky; top: 5.5rem; display: flex; flex-direction: column; gap: 1.6rem; }
  /* <p>, no <hN> — mismo motivo que .footer-heading: es un rótulo de navegación, no
     forma parte del esquema de encabezados de la página (el sidebar se renderiza antes
     que el encabezado h1 real del contenido, así que un h-tag acá quedaría antes de que exista
     cualquier encabezado de nivel 1). */
  .docs-nav-group .docs-nav-title { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-dim); margin: 0 0 0.5rem; font-weight: 700; }
  .docs-nav-group ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
  .docs-nav-group a { text-decoration: none; color: var(--text-muted); font-size: 0.88rem; display: block; padding: 0.15rem 0; }
  .docs-nav-group a:hover, .docs-nav-group a.is-active { color: var(--brand-soft); }
  .docs-content { min-width: 0; }
  .docs-section { padding-top: 0.5rem; margin-bottom: 3rem; scroll-margin-top: 5.5rem; }
  .docs-section h2 { font-size: 1.5rem; margin: 0 0 0.5rem; }
  .docs-section h3 { font-size: 1.05rem; margin: 1.6rem 0 0.6rem; }
  .docs-section p { color: var(--text-muted); font-size: 0.95rem; max-width: 68ch; }
  .docs-section code { background: var(--surface); border: 1px solid var(--border); border-radius: 5px; padding: 0.1rem 0.4rem; font-size: 0.86em; color: var(--brand-soft); }
  .docs-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 1rem 1.2rem; margin: 0.9rem 0; }
  .docs-card p { margin: 0; }
  .docs-list { color: var(--text-muted); font-size: 0.92rem; padding-left: 1.2rem; display: flex; flex-direction: column; gap: 0.45rem; max-width: 68ch; }

  /* /faq */
  .faq-item { border-bottom: 1px solid var(--border); }
  .faq-item summary { padding: 1.1rem 0.2rem; font-weight: 600; cursor: pointer; list-style: none; display: flex; justify-content: space-between; align-items: center; }
  .faq-item summary::-webkit-details-marker { display: none; }
  .faq-item summary::after { content: '+'; color: var(--brand-soft); font-size: 1.2rem; }
  .faq-item[open] summary::after { content: '−'; }
  .faq-item p { color: var(--text-muted); margin: 0 0 1.1rem 0.2rem; max-width: 68ch; }

  /* /status */
  .status-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1.1rem 1.3rem; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; margin-bottom: 0.7rem; }
  .status-row .status-name { font-weight: 600; }
  .status-row .status-note { color: var(--text-dim); font-size: 0.8rem; display: block; margin-top: 0.15rem; }
  .status-pill { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.82rem; font-weight: 600; white-space: nowrap; }
  .status-pill .dot { width: 8px; height: 8px; border-radius: 50%; }
  .status-ok .dot { background: #4ade80; } .status-ok { color: #4ade80; }
  .status-warn .dot { background: #facc15; } .status-warn { color: #facc15; }
  .status-bad .dot { background: #f87171; } .status-bad { color: #f87171; }
  .status-unknown .dot { background: var(--text-dim); } .status-unknown { color: var(--text-dim); }

  /* /changelog */
  .timeline { position: relative; padding-left: 1.8rem; border-left: 2px solid var(--border); display: flex; flex-direction: column; gap: 2.2rem; }
  .timeline-entry { position: relative; }
  .timeline-entry::before { content: ''; position: absolute; left: -2.35rem; top: 0.3rem; width: 11px; height: 11px; border-radius: 50%; background: var(--brand); border: 2px solid var(--bg); }
  .timeline-date { color: var(--text-dim); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .timeline-entry h2 { margin: 0.3rem 0 0.6rem; font-size: 1.05rem; }
  .timeline-entry ul { margin: 0; padding-left: 1.1rem; color: var(--text-muted); font-size: 0.9rem; display: flex; flex-direction: column; gap: 0.3rem; }

  @media (max-width: 900px) {
    .docs-layout { grid-template-columns: 1fr; }
    .docs-sidebar { position: static; flex-direction: row; flex-wrap: wrap; gap: 1rem 1.6rem; }
  }

  /* Footer */
  footer.site-footer { border-top: 1px solid var(--border); padding: 3.5rem 0 2rem; }
  .footer-grid { display: grid; grid-template-columns: 1.3fr repeat(3, 1fr); gap: 2rem; margin-bottom: 2.5rem; }
  .footer-brand p { color: var(--text-muted); font-size: 0.88rem; max-width: 32ch; margin-top: 0.6rem; }
  /* No es un <hN> real a propósito — el pie de página no forma parte del esquema de
     encabezados del documento, mismo motivo por el que <nav>/<footer> ya tienen su
     propio landmark; usar h4 acá generaba un salto real h2->h4 en TODAS las páginas
     (encontrado en la revisión de accesibilidad de Fase 5, corregido acá). */
  .footer-col .footer-heading { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-dim); margin: 0 0 0.9rem; font-weight: 700; }
  .footer-col ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.6rem; }
  .footer-col a { text-decoration: none; color: var(--text-muted); font-size: 0.88rem; }
  .footer-col a:hover { color: var(--text); }
  .footer-bottom { border-top: 1px solid var(--border); padding-top: 1.5rem; color: var(--text-dim); font-size: 0.8rem; }

  [data-reveal] { opacity: 1; transform: none; }
  .js-reveal-ready [data-reveal] { opacity: 0; transform: translateY(14px); transition: opacity .5s ease, transform .5s ease; }
  .js-reveal-ready [data-reveal].is-visible { opacity: 1; transform: none; }
  @media (prefers-reduced-motion: reduce) { .js-reveal-ready [data-reveal] { opacity: 1; transform: none; transition: none; } }

  @media (max-width: 900px) {
    .hero-grid, .split, .split.reverse { grid-template-columns: 1fr; }
    .split.reverse { direction: ltr; }
    .feature-grid, .audience-grid, .trust-grid { grid-template-columns: repeat(2, 1fr); }
    .stats-grid { grid-template-columns: repeat(2, 1fr); }
    .diagram-branches { grid-template-columns: 1fr; }
    .footer-grid { grid-template-columns: repeat(2, 1fr); }
  }
  @media (max-width: 720px) {
    nav.nav-links {
      display: none; position: absolute; top: 100%; left: 0; right: 0; flex-direction: column;
      gap: 0; background: var(--bg-raised); border-bottom: 1px solid var(--border); padding: 0.5rem 1.5rem;
    }
    nav.nav-links a { padding: 0.75rem 0; border-bottom: 1px solid var(--border); }
    nav.nav-links a:last-child { border-bottom: none; }
    .nav-toggle { display: inline-flex; }
  }
  @media (max-width: 560px) {
    .feature-grid, .audience-grid, .trust-grid, .stats-grid, .connected-layer { grid-template-columns: 1fr; }
    .mock-body { grid-template-columns: 1fr; }
    .footer-grid { grid-template-columns: 1fr; gap: 1.75rem; }
    section { padding: 3.5rem 0; }
    .hero { padding: 3rem 0 2.5rem; }
    .cmd-summary { grid-template-columns: 1fr; }
    .cmd-badge { justify-self: start; }
  }
`;

function renderNav() {
  const dashboardHref = websiteConfig.dashboardUrl || null;
  const loginHref = buildDashboardLoginUrl();
  return `
<header class="site-nav">
  <div class="nav-inner">
    <a class="nav-brand" href="/"><span class="dot" aria-hidden="true"></span>${escapeHtml(BRAND_NAME.replace(' Bot', ''))}</a>
    <nav class="nav-links" id="primary-nav" aria-label="Principal">
      <a href="/#funciones">Funciones</a>
      ${dashboardHref ? `<a href="${escapeHtml(dashboardHref)}" target="_blank" rel="noopener">Dashboard</a>` : ''}
      <a href="/commands">Comandos</a>
      <a href="/docs">Documentación</a>
      <a href="/faq">FAQ</a>
    </nav>
    <div class="nav-actions">
      ${loginHref ? `<a class="btn btn-ghost btn-sm" href="${escapeHtml(loginHref)}">Iniciar sesión</a>` : ''}
      <a class="btn btn-primary btn-sm" href="${escapeHtml(buildInviteUrl())}" target="_blank" rel="noopener">Añadir NEXO</a>
      <button type="button" class="nav-toggle" aria-controls="primary-nav" aria-expanded="false" aria-label="Abrir menú">☰</button>
    </div>
  </div>
</header>`;
}

function renderFooter() {
  const dashboardHref = websiteConfig.dashboardUrl || null;
  return `
<footer class="site-footer">
  <div class="wrap">
    <div class="footer-grid">
      <div class="footer-brand">
        <a class="nav-brand" href="/"><span class="dot" aria-hidden="true"></span>${escapeHtml(BRAND_NAME.replace(' Bot', ''))}</a>
        <p>La plataforma para administrar y hacer crecer tu comunidad de Discord — moderación, economía, progresión y gestión, todo en un solo bot.</p>
      </div>
      <div class="footer-col">
        <p class="footer-heading">Producto</p>
        <ul>
          <li><a href="/#funciones">Funciones</a></li>
          ${dashboardHref ? `<li><a href="${escapeHtml(dashboardHref)}" target="_blank" rel="noopener">Dashboard</a></li>` : ''}
          <li><a href="/commands">Comandos</a></li>
          <li><a href="/docs">Documentación</a></li>
          <li><a href="/changelog">Changelog</a></li>
          <li><a href="/status">Status</a></li>
          <li><a href="${escapeHtml(buildInviteUrl())}" target="_blank" rel="noopener">Añadir NEXO</a></li>
        </ul>
      </div>
      <div class="footer-col">
        <p class="footer-heading">Soporte</p>
        <ul>
          <li><a href="/faq">FAQ</a></li>
          ${websiteConfig.supportContact ? `<li>${escapeHtml(websiteConfig.supportContact)}</li>` : ''}
        </ul>
      </div>
      <div class="footer-col">
        <p class="footer-heading">Legal</p>
        <ul>
          <li><a href="/legal/terminos">Términos de servicio</a></li>
          <li><a href="/legal/privacidad">Política de privacidad</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">© ${new Date().getFullYear()} NEXO. No afiliado a Discord Inc.</div>
  </div>
</footer>`;
}

// Script mínimo, sin dependencias: scroll-reveal (IntersectionObserver) + contador
// animado de estadísticas + menú mobile. Respeta prefers-reduced-motion (si está activo,
// nunca agrega la clase que dispara la animación con transición — los estilos de arriba
// ya muestran todo directo en ese caso).
const PAGE_SCRIPT = `
(function () {
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduceMotion && 'IntersectionObserver' in window) {
    document.documentElement.classList.add('js-reveal-ready');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add('is-visible'); io.unobserve(entry.target); }
      });
    }, { threshold: 0.15 });
    document.querySelectorAll('[data-reveal]').forEach(function (el) { io.observe(el); });
  }

  if (!reduceMotion) {
    var counters = document.querySelectorAll('[data-count-to]');
    var counted = new WeakSet();
    var countIo = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting || counted.has(entry.target)) return;
        counted.add(entry.target);
        var el = entry.target;
        var target = parseInt(el.getAttribute('data-count-to'), 10) || 0;
        var start = performance.now();
        var duration = 900;
        function tick(now) {
          var progress = Math.min(1, (now - start) / duration);
          var eased = 1 - Math.pow(1 - progress, 3);
          el.textContent = Math.round(eased * target).toLocaleString('es-ES');
          if (progress < 1) requestAnimationFrame(tick); else el.textContent = target.toLocaleString('es-ES');
        }
        requestAnimationFrame(tick);
      });
    }, { threshold: 0.4 }) : null;
    counters.forEach(function (el) { if (countIo) countIo.observe(el); });
  }

  var featureCards = document.querySelectorAll('.feature-card');
  var detailPanel = document.getElementById('feature-detail-panel');
  if (featureCards.length && detailPanel) {
    featureCards.forEach(function (card) {
      card.addEventListener('click', function () {
        featureCards.forEach(function (c) { c.setAttribute('aria-pressed', 'false'); });
        card.setAttribute('aria-pressed', 'true');
        var id = card.getAttribute('data-feature-id');
        document.querySelectorAll('.feature-detail').forEach(function (panel) {
          panel.classList.toggle('is-active', panel.getAttribute('data-feature-id') === id);
        });
        detailPanel.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
      });
    });
  }

  var navToggle = document.querySelector('.nav-toggle');
  var navLinks = document.querySelector('.nav-links');
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', function () {
      var open = navLinks.style.display === 'flex';
      navLinks.style.display = open ? 'none' : 'flex';
      navToggle.setAttribute('aria-expanded', String(!open));
    });
  }
})();
`;

export function renderPage({ title, description, path = '/', bodyHtml, extraHead = '' }) {
  const canonical = websiteConfig.siteUrl ? `${websiteConfig.siteUrl}${path}` : null;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
${canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}">` : ''}
<meta property="og:type" content="website">
<meta property="og:site_name" content="NEXO">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
${canonical ? `<meta property="og:url" content="${escapeHtml(canonical)}">` : ''}
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="theme-color" content="${BRAND_COLOR}">
<link rel="icon" href="${FAVICON_HREF}">
${extraHead}
<style>${GLOBAL_STYLES}</style>
</head>
<body>
<a class="skip-link" href="#contenido">Saltar al contenido</a>
${renderNav()}
<main id="contenido">${bodyHtml}</main>
${renderFooter()}
<script>${PAGE_SCRIPT}</script>
</body>
</html>`;
}
