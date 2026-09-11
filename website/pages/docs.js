// /docs — página única con sidebar ancla (no subrutas todavía): con el contenido real
// que hay hoy, partirlo en URLs separadas sería más estructura de la que hace falta
// (regla del prompt maestro: no sobreingeniería). Si el contenido crece mucho, ahí sí
// vale la pena moverlo a /docs/:slug — la arquitectura (sidebar + secciones con id)
// ya lo permite sin rehacer nada.
import { escapeHtml } from '../layout.js';
import { websiteConfig } from '../config.js';
import { ESSENTIAL_BOT_PERMISSIONS } from '../../src/utils/botPermissions.js';
import { FEATURES } from '../data/features.js';

const NAV = [
  {
    title: 'Introducción',
    items: [
      { id: 'que-es', label: '¿Qué es NEXO?' },
      { id: 'primeros-pasos', label: 'Primeros pasos' },
      { id: 'instalacion', label: 'Instalación y permisos' },
    ],
  },
  {
    title: 'Configuración',
    items: [
      { id: 'setup', label: '/setup' },
      { id: 'config', label: '/config' },
      { id: 'permisos', label: 'Permisos (3 niveles)' },
      { id: 'canales', label: 'Canales de log' },
    ],
  },
  {
    title: 'Funciones',
    items: FEATURES.filter((f) => f.id !== 'voz').map((f) => ({ id: `f-${f.id}`, label: `${f.emoji} ${f.name}` })),
  },
  {
    title: 'Referencia',
    items: [
      { id: 'referencia', label: 'Comandos y FAQ' },
    ],
  },
];

function renderSidebar() {
  return `<nav class="docs-sidebar" aria-label="Documentación">
    ${NAV.map((group) => `
      <div class="docs-nav-group">
        <h4>${escapeHtml(group.title)}</h4>
        <ul>${group.items.map((item) => `<li><a href="#${item.id}">${escapeHtml(item.label)}</a></li>`).join('')}</ul>
      </div>`).join('')}
  </nav>`;
}

function renderIntro() {
  return `
  <div class="docs-section" id="que-es">
    <h2>¿Qué es NEXO?</h2>
    <p>NEXO es una plataforma para administrar y hacer crecer tu comunidad de Discord: moderación, economía, progresión (XP/niveles) y herramientas de gestión, todo en un solo bot multi-servidor. Un único proceso atiende cualquier cantidad de servidores — cada uno con su propia configuración, guardada en base de datos, nunca en variables de entorno.</p>
  </div>
  <div class="docs-section" id="primeros-pasos">
    <h2>Primeros pasos</h2>
    <p>Tres pasos, sin editar nada a mano:</p>
    <ol class="docs-list">
      <li>Invitá a NEXO a tu servidor (necesitás permiso de <strong>Administrador</strong> en Discord para instalarlo).</li>
      <li>Corré <code>/setup</code> — arma automáticamente el rol de staff, los canales de log y los módulos que elijas.</li>
      <li>Listo. <code>/help</code> muestra a cualquier miembro los comandos disponibles según lo que tu servidor tenga activado.</li>
    </ol>
  </div>
  <div class="docs-section" id="instalacion">
    <h2>Instalación y permisos</h2>
    <p>NEXO pide un conjunto de permisos de Discord al instalarse — los que sus funciones realmente usan, ni más ni menos:</p>
    <div class="docs-card">
      <p>${ESSENTIAL_BOT_PERMISSIONS.map((p) => escapeHtml(p.label)).join(' · ')}</p>
    </div>
    <p>Si más adelante le sacás alguno de estos permisos por accidente (reordenando roles, por ejemplo), <code>/estado</code> y el panel de <code>/setup</code> te avisan qué falta — no hace falta adivinar por qué algo dejó de funcionar.</p>
  </div>`;
}

function renderConfiguracion() {
  return `
  <div class="docs-section" id="setup">
    <h2>/setup</h2>
    <p>Crea automáticamente lo que falte (canales, categoría, roles) y reutiliza lo que ya exista si volvés a correrlo — nunca duplica. Desde el mismo panel activás moderación, economía y XP, y opcionalmente: canal de bienvenida, canal de confesiones, rol automático para miembros nuevos, rol de castigo y roles autoasignables.</p>
  </div>
  <div class="docs-section" id="config">
    <h2>/config</h2>
    <p>Para cuando ya tenés un rol o canal armado y querés que NEXO use ESE en vez de crear uno nuevo. Es el complemento de <code>/setup</code>, no un reemplazo: dos caminos al mismo dato — "crear de cero" o "reusar lo mío".</p>
  </div>
  <div class="docs-section" id="permisos">
    <h2>Permisos: 3 niveles</h2>
    <ul class="docs-list">
      <li><strong>Moderador</strong> — moderación completa: <code>/warn</code>, <code>/ban</code>, <code>/kick</code>, <code>/timeout</code>, <code>/punish</code>, <code>/sanciones</code>.</li>
      <li><strong>Administrador</strong> — todo lo de moderador, más <code>/economia-staff</code> y <code>/xp</code> (los únicos comandos que acreditan saldo o XP sin límite).</li>
      <li><strong>Dueño / Administrator nativo de Discord</strong> — <code>/setup</code> y <code>/config</code>.</li>
    </ul>
    <p>Un servidor que nunca separa los roles con <code>/config rol-admin</code> sigue funcionando exactamente igual que antes de que este segundo nivel existiera — no es un paso obligatorio.</p>
  </div>
  <div class="docs-section" id="canales">
    <h2>Canales de log</h2>
    <p>Tres canales independientes, cada uno opcional: <strong>moderación</strong> (bans, warns, timeouts), <strong>actividad</strong> (cambios de configuración, ingresos/egresos, edición de mensajes) y <strong>economía</strong> (ajustes de staff sobre saldo/XP). Podés activar solo los que te interesen.</p>
  </div>`;
}

function renderFunciones() {
  return FEATURES.filter((f) => f.id !== 'voz').map((f) => `
  <div class="docs-section" id="f-${f.id}">
    <h2>${f.emoji} ${escapeHtml(f.name)}</h2>
    <p>${escapeHtml(f.description)}</p>
    <p><a href="/commands?categoria=${f.id}">Ver los ${f.commandCount} comandos de esta categoría →</a></p>
  </div>`).join('');
}

function renderReferencia() {
  return `
  <div class="docs-section" id="referencia">
    <h2>Comandos y FAQ</h2>
    <p>El detalle completo de cada comando (opciones, permisos, subcomandos) vive en el <a href="/commands">explorador de comandos</a>, generado directo desde el código del bot. Preguntas frecuentes sobre instalación, personalización y soporte están en la <a href="/faq">FAQ</a>.</p>
    ${websiteConfig.supportContact ? `<p>¿Algo no cubierto acá? ${escapeHtml(websiteConfig.supportContact)}</p>` : ''}
  </div>`;
}

export function renderDocsPage() {
  return `
<section class="tight">
  <div class="wrap docs-layout">
    ${renderSidebar()}
    <div class="docs-content">
      ${renderIntro()}
      ${renderConfiguracion()}
      ${renderFunciones()}
      ${renderReferencia()}
    </div>
  </div>
</section>`;
}
