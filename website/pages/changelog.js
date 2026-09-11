import { escapeHtml } from '../layout.js';
import { CHANGELOG } from '../data/changelog.js';

function formatDate(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function renderChangelogPage() {
  return `
<section class="tight">
  <div class="wrap" style="max-width:760px">
    <div class="section-head" data-reveal>
      <span class="eyebrow">Changelog</span>
      <h1>Historial de NEXO</h1>
      <p>Sin números de versión formales todavía — cada hito lleva su fecha real.</p>
    </div>
    <div class="timeline" data-reveal>
      ${CHANGELOG.map((entry) => `<div class="timeline-entry">
        <span class="timeline-date">${escapeHtml(formatDate(entry.date))}</span>
        <h2>${escapeHtml(entry.title)}</h2>
        <ul>${entry.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </div>`).join('')}
    </div>
  </div>
</section>`;
}
