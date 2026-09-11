// /status — sección 22 del prompt maestro. Solo lista servicios que existen de verdad
// (Bot, Dashboard, Base de datos, Sitio web) — nada de música/IA/APIs que no existen.
//
// Por qué NO hay un semáforo verde/rojo en vivo para el bot/dashboard/base de datos:
// website/ está diseñado a propósito SIN DISCORD_TOKEN ni SUPABASE_SERVICE_ROLE_KEY en
// memoria (ver website/config.js) — así que este proceso no tiene ninguna forma honesta
// de consultar si el bot está conectado al gateway o si Supabase responde. Fingir un
// "● Operativo" ahí sería inventar un dato, no medirlo. Lo único que SÍ es una medición
// real es la plataforma de Discord (API pública de discordstatus.com) y el sitio mismo
// (si esta página cargó, está arriba). Para un estado en vivo real de bot/dashboard/DB,
// la vía honesta ya existe dentro de Discord: /estado (ver src/commands/admin/estado.js)
// hace un ping real a Supabase y muestra la latencia real del gateway — evaluar más
// adelante si vale la pena exponer eso en un endpoint público del dashboard, fuera de
// esta fase.
import { escapeHtml } from '../layout.js';
import { getDiscordPlatformStatus } from '../data/discordStatus.js';

function pillClass(indicator) {
  if (indicator === 'none') return 'status-ok';
  if (indicator === 'minor') return 'status-warn';
  if (indicator === 'major' || indicator === 'critical') return 'status-bad';
  return 'status-unknown';
}

function renderRow({ name, note, pillLabel, pillClassName }) {
  return `<div class="status-row">
    <div>
      <span class="status-name">${escapeHtml(name)}</span>
      <span class="status-note">${note}</span>
    </div>
    <span class="status-pill ${pillClassName}"><span class="dot" aria-hidden="true"></span>${escapeHtml(pillLabel)}</span>
  </div>`;
}

export async function renderStatusPage() {
  const discord = await getDiscordPlatformStatus();

  const rows = [
    renderRow({
      name: 'Sitio web',
      note: 'Esta misma página.',
      pillLabel: 'Operativo',
      pillClassName: 'status-ok',
    }),
    renderRow({
      name: 'Plataforma de Discord',
      note: 'Fuente: discordstatus.com (estado oficial de Discord, no de NEXO).',
      pillLabel: discord.label,
      pillClassName: pillClass(discord.indicator),
    }),
    renderRow({
      name: 'Bot de NEXO',
      note: 'Sin monitoreo público automático todavía — corré /estado dentro de tu servidor para latencia real y conexión a la base.',
      pillLabel: 'Sin datos públicos',
      pillClassName: 'status-unknown',
    }),
    renderRow({
      name: 'Dashboard',
      note: 'Sin monitoreo público automático todavía.',
      pillLabel: 'Sin datos públicos',
      pillClassName: 'status-unknown',
    }),
    renderRow({
      name: 'Base de datos',
      note: 'Verificable en vivo con /estado (ping real a Supabase, nunca cacheado).',
      pillLabel: 'Sin datos públicos',
      pillClassName: 'status-unknown',
    }),
  ];

  return `
<section class="tight">
  <div class="wrap" style="max-width:760px">
    <div class="section-head" data-reveal>
      <span class="eyebrow">Estado</span>
      <h2>Estado de NEXO</h2>
      <p>Los servicios propios (bot, dashboard, base de datos) todavía no tienen monitoreo público automático — usá <code>/estado</code> dentro de Discord para un diagnóstico real en cualquier momento.</p>
    </div>
    <div data-reveal>${rows.join('')}</div>
  </div>
</section>`;
}
