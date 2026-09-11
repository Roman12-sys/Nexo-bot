import { escapeHtml, buildInviteUrl } from '../layout.js';
import { websiteConfig } from '../config.js';
import { ESSENTIAL_BOT_PERMISSIONS } from '../../src/utils/botPermissions.js';
import { stats } from '../data/stats.js';

function buildFaqItems() {
  const dashboardHref = websiteConfig.dashboardUrl;
  return [
    {
      q: '¿Qué es NEXO?',
      a: 'Una plataforma para administrar y hacer crecer tu comunidad de Discord: moderación, economía, progresión y herramientas de gestión, todo en un solo bot multi-servidor.',
    },
    {
      q: '¿Cómo agrego NEXO a mi servidor?',
      a: `Con el botón "Añadir NEXO" de esta página (<a href="${escapeHtml(buildInviteUrl())}" target="_blank" rel="noopener">enlace directo</a>). Necesitás permiso de Administrador en el servidor para instalarlo. Después corré <code>/setup</code> dentro de Discord.`,
    },
    {
      q: '¿Qué permisos necesita?',
      a: `${ESSENTIAL_BOT_PERMISSIONS.map((p) => escapeHtml(p.label)).join(', ')} — los que sus funciones reales usan, ni uno más. El link de invitación ya viene con estos pre-tildados, aunque podés destildar cualquiera en la pantalla de Discord.`,
    },
    {
      q: '¿Puedo personalizarlo?',
      a: 'Sí. Cada servidor tiene su propia configuración (roles de staff, canales de log, qué módulos están activos, extras opcionales como bienvenida o confesiones) — se arma con <code>/setup</code> y se ajusta con <code>/config</code>, sin tocar código ni archivos.',
    },
    {
      q: '¿Tiene dashboard?',
      a: dashboardHref
        ? `Sí, de solo lectura — <a href="${escapeHtml(dashboardHref)}" target="_blank" rel="noopener">accedé acá</a> con tu cuenta de Discord. Muestra la configuración y actividad real de tu servidor; no reemplaza a <code>/setup</code>/<code>/config</code> como forma de configurar.`
        : 'Sí, de solo lectura — acceso vía tu cuenta de Discord. La URL pública de este entorno todavía no está configurada en el sitio.',
    },
    {
      q: '¿Qué funciones incluye?',
      a: `${stats.commands} comandos en ${stats.categories} categorías: moderación, economía, casino, XP y progresión, diversión, interacción entre miembros, sorteos, anuncios, voz temporal y administración. El detalle completo está en <a href="/#funciones">Funciones</a>.`,
    },
    {
      q: '¿Dónde están los comandos?',
      a: 'En el <a href="/commands">explorador de comandos</a> — buscador y filtro por categoría, generado directo desde el código del bot (nunca se desactualiza a mano).',
    },
    {
      q: '¿Cómo obtengo soporte?',
      a: websiteConfig.supportContact
        ? escapeHtml(websiteConfig.supportContact)
        : 'Todavía no hay un canal de soporte público configurado para NEXO.',
    },
  ];
}

export function renderFaqPage() {
  const items = buildFaqItems();
  return `
<section class="tight">
  <div class="wrap" style="max-width:760px">
    <div class="section-head" data-reveal>
      <span class="eyebrow">FAQ</span>
      <h1>Preguntas frecuentes</h1>
    </div>
    <div data-reveal>
      ${items.map((item, i) => `<details class="faq-item"${i === 0 ? ' open' : ''}>
        <summary>${escapeHtml(item.q)}</summary>
        <p>${item.a}</p>
      </details>`).join('')}
    </div>
  </div>
</section>`;
}
