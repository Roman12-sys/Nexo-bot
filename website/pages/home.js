// Landing page (Fase 4). Compone las secciones del prompt maestro usando SOLO datos
// verificados contra el repo real (website/data/features.js, website/data/stats.js) —
// nada de esto está hardcodeado a mano sin trazabilidad. Ver el reporte de la sesión
// para el detalle de qué se decidió mostrar y por qué.
import { escapeHtml, buildInviteUrl } from '../layout.js';
import { websiteConfig } from '../config.js';
import { FEATURES } from '../data/features.js';
import { stats } from '../data/stats.js';
import { BRAND_NAME } from '../../src/utils/embeds.js';

const WORDMARK = BRAND_NAME.replace(' Bot', ''); // "Nexo Bot" -> "Nexo", mismo dato, solo el estilo de marca que pide el prompt (sección 3).

function renderHero() {
  return `
<section class="hero">
  <div class="wrap hero-grid">
    <div>
      <h1><span>Tu servidor.</span><span>Tu comunidad.</span><span class="accent">Tu ${escapeHtml(WORDMARK)}.</span></h1>
      <p class="hero-sub">Moderación, economía, progresión y herramientas de gestión — todas las herramientas que tu comunidad de Discord necesita, reunidas en un solo bot multi-servidor.</p>
      <div class="hero-ctas">
        <a class="btn btn-primary" href="${escapeHtml(buildInviteUrl())}" target="_blank" rel="noopener">Añadir NEXO</a>
        <a class="btn btn-ghost" href="#funciones">Explorar funciones</a>
      </div>
      <p class="hero-meta"><strong>${stats.commands}</strong> comandos · <strong>${stats.categories}</strong> categorías · un solo <code>/setup</code> para configurar todo</p>
    </div>
    <div class="preview-frame" data-reveal>
      <span class="preview-label"><span class="dot-live" aria-hidden="true"></span>Vista previa conceptual del dashboard — no es una captura real</span>
      <div class="mock-dashboard" role="img" aria-label="Representación del panel de NEXO mostrando estadísticas de un servidor">
        <div class="mock-titlebar"><span class="mock-dot"></span><span class="mock-dot"></span><span class="mock-dot"></span><span class="mock-url">Panel de tu servidor</span></div>
        <div class="mock-body">
          <div class="mock-tile"><div class="mock-label">Miembros</div><div class="mock-value">3.482</div></div>
          <div class="mock-tile"><div class="mock-label">Mensajes hoy</div><div class="mock-value">1.204</div></div>
          <div class="mock-tile"><div class="mock-label">Monedas en circulación</div><div class="mock-value">89.4K</div></div>
          <div class="mock-row"><span>Estado del bot</span><span class="badge-ok">● Operativo</span></div>
        </div>
      </div>
    </div>
  </div>
</section>`;
}

function renderQueEsNexo() {
  return `
<section class="tight">
  <div class="wrap">
    <div class="section-head" data-reveal>
      <span class="eyebrow">Más que un bot de Discord</span>
      <h2>Un solo lugar para conectar las herramientas de tu comunidad</h2>
      <p>NEXO no es una colección suelta de comandos: es una plataforma. Un único proceso atiende cualquier cantidad de servidores, cada uno con su propia configuración, sus propios roles y su propia economía — sin tocar código ni variables de entorno.</p>
    </div>
    <div class="diagram" data-reveal>
      <div class="diagram-branches">
        <div class="diagram-node"><div class="node-title">🧹 Moderación</div><div class="node-sub">Seguridad del servidor</div></div>
        <div class="diagram-node"><div class="node-title">⭐ Progresión</div><div class="node-sub">Comunidad activa</div></div>
        <div class="diagram-node"><div class="node-title">💰 Economía</div><div class="node-sub">Recompensas reales</div></div>
      </div>
      <div class="diagram-connector"></div>
      <div class="diagram-center"><span class="diagram-root">TU SERVIDOR</span></div>
    </div>
  </div>
</section>`;
}

function renderFeatureCard(feature) {
  return `<button type="button" class="feature-card" data-feature-id="${feature.id}" aria-pressed="false" data-reveal>
    <span class="f-emoji" aria-hidden="true">${feature.emoji}</span>
    <span class="f-name">${escapeHtml(feature.name)}</span>
    <p class="f-tagline">${escapeHtml(feature.tagline)}</p>
    <span class="f-count">${feature.commandCount > 0 ? `${feature.commandCount} comando${feature.commandCount === 1 ? '' : 's'}` : 'Automático'}</span>
  </button>`;
}

function renderFeatureDetail(feature, index) {
  return `<div class="feature-detail${index === 0 ? ' is-active' : ''}" data-feature-id="${feature.id}">
    <h3>${feature.emoji} ${escapeHtml(feature.name)}</h3>
    <p class="f-description">${escapeHtml(feature.description)}</p>
    <div class="command-chip-row">
      ${feature.sampleCommands.map((c) => `<span class="command-chip">${escapeHtml(c)}</span>`).join('')}
    </div>
  </div>`;
}

function renderFunciones() {
  return `
<section id="funciones">
  <div class="wrap">
    <div class="section-head" data-reveal>
      <span class="eyebrow">Funciones</span>
      <h2>Todo lo que una comunidad necesita, en un bot</h2>
      <p>${stats.commands} comandos reales, agrupados en ${stats.categories} categorías — tocá una tarjeta para ver el detalle.</p>
    </div>
    <div class="feature-grid">${FEATURES.map(renderFeatureCard).join('')}</div>
    <div id="feature-detail-panel">${FEATURES.map(renderFeatureDetail).join('')}</div>
  </div>
</section>`;
}

function renderTodoConectado() {
  const row1 = FEATURES.slice(0, 3);
  const row2 = FEATURES.slice(3, 6);
  const row3 = FEATURES.slice(6, 9);
  return `
<section class="tight">
  <div class="wrap">
    <div class="section-head" data-reveal>
      <span class="eyebrow">Todo conectado</span>
      <h2>No necesitás cinco bots</h2>
      <p>Menos herramientas dispersas. Más control — todo comparte la misma configuración, el mismo staff y el mismo panel.</p>
    </div>
    <div class="connected-stack" data-reveal>
      <div class="connected-pill" style="margin-bottom:0.6rem;">DISCORD</div>
      <div class="diagram-connector"></div>
      <span class="diagram-root" style="margin-bottom:0.6rem;">NEXO</span>
      <div class="diagram-connector"></div>
      <div class="connected-layer" style="margin-bottom:0.6rem;">${row1.map((f) => `<div class="connected-pill">${f.emoji} ${escapeHtml(f.name)}</div>`).join('')}</div>
      <div class="connected-layer" style="margin-bottom:0.6rem;">${row2.map((f) => `<div class="connected-pill">${f.emoji} ${escapeHtml(f.name)}</div>`).join('')}</div>
      <div class="connected-layer">${row3.map((f) => `<div class="connected-pill">${f.emoji} ${escapeHtml(f.name)}</div>`).join('')}</div>
    </div>
  </div>
</section>`;
}

function renderDashboardSection() {
  const dashboardHref = websiteConfig.dashboardUrl;
  return `
<section>
  <div class="wrap split">
    <div data-reveal>
      <span class="eyebrow">Dashboard</span>
      <h2>Controlá NEXO desde un solo lugar</h2>
      <p style="color:var(--text-muted)">Configurá tu servidor sin tener que memorizar decenas de comandos. El dashboard es de solo lectura por diseño — pensado para seguir la actividad de tu servidor sin entrar a Discord, nunca para reemplazar la configuración real.</p>
      <ul class="check-list">
        <li>Roles de moderador y administrador, separados en 3 niveles de permisos</li>
        <li>3 canales de log independientes (moderación, actividad, economía)</li>
        <li>Bienvenida, confesiones, rol automático y rol de castigo, cada uno opt-in</li>
        <li>Roles autoasignables y roles por nivel (acumulativos o de reemplazo)</li>
        <li>Digest semanal de actividad, opt-in por servidor</li>
      </ul>
      ${dashboardHref
        ? `<a class="btn btn-primary" href="${escapeHtml(dashboardHref)}" target="_blank" rel="noopener">Abrir Dashboard</a>`
        : `<a class="btn btn-ghost" href="${escapeHtml(buildInviteUrl())}" target="_blank" rel="noopener">Añadir NEXO para acceder</a>`}
    </div>
    <div class="preview-frame" data-reveal>
      <span class="preview-label"><span class="dot-live" aria-hidden="true"></span>Vista previa conceptual — no es una captura real</span>
      <div class="mock-dashboard">
        <div class="mock-titlebar"><span class="mock-dot"></span><span class="mock-dot"></span><span class="mock-dot"></span><span class="mock-url">Configuración actual</span></div>
        <div class="mock-body">
          <div class="mock-row"><span>Rol de moderador</span><span>@Staff</span></div>
          <div class="mock-row"><span>Rol de administrador</span><span>@Admin</span></div>
          <div class="mock-row"><span>Canal de logs de moderación</span><span>#logs-mod</span></div>
          <div class="mock-row"><span>Economía</span><span class="badge-ok">● Activada</span></div>
        </div>
      </div>
    </div>
  </div>
</section>`;
}

function renderEnAccion() {
  return `
<section class="tight">
  <div class="wrap">
    <div class="section-head" data-reveal>
      <span class="eyebrow">NEXO en acción</span>
      <h2>Así se ve dentro de Discord</h2>
      <p>Representaciones del estilo real de los embeds del bot — no capturas de pantalla.</p>
    </div>
    <div class="feature-grid" data-reveal>
      <div class="feature-card" style="cursor:default;">
        <span class="f-emoji">💰</span>
        <span class="f-name">/balance</span>
        <p class="f-tagline">"Balance de Usuario" — 1.250 monedas · + 400 en el banco</p>
      </div>
      <div class="feature-card" style="cursor:default;">
        <span class="f-emoji">🧹</span>
        <span class="f-name">/warn</span>
        <p class="f-tagline">"Advertencia aplicada" — motivo, moderador y fecha, con historial</p>
      </div>
      <div class="feature-card" style="cursor:default;">
        <span class="f-emoji">⭐</span>
        <span class="f-name">/nivel</span>
        <p class="f-tagline">"Nivel 12" — ■■■■■■□□□□ 64% hacia el siguiente nivel</p>
      </div>
    </div>
  </div>
</section>`;
}

function renderParaQuien() {
  const groups = [
    { key: 'gaming', title: 'Gaming', desc: 'Servidores de juego que quieren competencia sana y una economía con la que jugar.' },
    { key: 'comunidades', title: 'Comunidades', desc: 'Comunidades generales que necesitan moderación seria y una forma de premiar la participación.' },
    { key: 'creadores', title: 'Creadores', desc: 'Creadores de contenido que quieren anunciar, sortear y mantener organizada a su audiencia.' },
  ];
  return `
<section>
  <div class="wrap">
    <div class="section-head" data-reveal>
      <span class="eyebrow">Para quién es NEXO</span>
      <h2>Se adapta a tu tipo de comunidad</h2>
    </div>
    <div class="audience-grid" data-reveal>
      ${groups.map((g) => {
        const relevant = FEATURES.filter((f) => f.audiences.includes(g.key)).slice(0, 4);
        return `<div class="audience-card">
          <h3>${escapeHtml(g.title)}</h3>
          <p>${escapeHtml(g.desc)}</p>
          <ul>${relevant.map((f) => `<li>${f.emoji} ${escapeHtml(f.name)}</li>`).join('')}</ul>
        </div>`;
      }).join('')}
    </div>
  </div>
</section>`;
}

function renderStats() {
  const items = [
    { label: 'Comandos', value: stats.commands },
    { label: 'Categorías', value: stats.categories },
    { label: 'Tests automatizados', value: stats.tests },
    { label: 'Sistemas', value: stats.systems.length },
  ];
  return `
<section class="tight">
  <div class="wrap">
    <div class="section-head" data-reveal>
      <span class="eyebrow">Construido para crecer</span>
      <h2>Números reales de este mismo repositorio</h2>
    </div>
    <div class="stats-grid" data-reveal>
      ${items.map((i) => `<div class="stat-block"><div class="stat-num" data-count-to="${i.value}">0</div><div class="stat-label">${escapeHtml(i.label)}</div></div>`).join('')}
    </div>
  </div>
</section>`;
}

function renderConfiabilidad() {
  const cards = [
    { icon: '🔐', title: 'Permisos', desc: 'Tres niveles reales (moderador, administrador, dueño) sobre los permisos nativos de Discord — no todo el staff puede acreditar saldo o XP sin límite.' },
    { icon: '🗄️', title: 'Persistencia', desc: 'Las operaciones de economía y XP pasan por funciones atómicas en la base de datos, no por lecturas y escrituras sueltas desde el bot.' },
    { icon: '⚙️', title: 'Arquitectura', desc: 'Sorteos, restricciones con duración y recordatorios se reprograman solos si el bot se reinicia — nada queda a mitad de camino.' },
    { icon: '✅', title: 'Mantenimiento', desc: `${stats.tests.toLocaleString('es-ES')} tests automatizados corren antes de cada cambio de código.` },
  ];
  return `
<section>
  <div class="wrap">
    <div class="section-head" data-reveal>
      <span class="eyebrow">Confiabilidad</span>
      <h2>Tu comunidad merece una base confiable</h2>
    </div>
    <div class="trust-grid" data-reveal>
      ${cards.map((c) => `<div class="trust-card"><h3>${c.icon} ${escapeHtml(c.title)}</h3><p>${escapeHtml(c.desc)}</p></div>`).join('')}
    </div>
  </div>
</section>`;
}

function renderCtaFinal() {
  return `
<section>
  <div class="wrap">
    <div class="cta-band" data-reveal>
      <h2>Sumá NEXO a tu servidor</h2>
      <p>Instalación en menos de un minuto — el resto se configura con <code>/setup</code>.</p>
      <a class="btn btn-primary" href="${escapeHtml(buildInviteUrl())}" target="_blank" rel="noopener">Añadir NEXO</a>
    </div>
  </div>
</section>`;
}

export function renderHomePage() {
  return [
    renderHero(),
    renderQueEsNexo(),
    renderFunciones(),
    renderTodoConectado(),
    renderDashboardSection(),
    renderEnAccion(),
    renderParaQuien(),
    renderStats(),
    renderConfiabilidad(),
    renderCtaFinal(),
  ].join('\n');
}
