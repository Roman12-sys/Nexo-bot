// /commands — explorador de comandos. Fuente de datos: website/data/commands.js, que
// lee el JSON generado por scripts/generate-commands-data.js a partir de los
// SlashCommandBuilder reales (nunca datos tipeados a mano) — ver el comentario de ese
// script para el motivo de que sea un paso de build aparte y no algo que el proceso del
// sitio calcule solo.
import { escapeHtml } from '../layout.js';
import { COMMANDS, COMMANDS_GENERATED_AT, formatPermissionLabel } from '../data/commands.js';
import { CATEGORY_META } from '../data/categories.js';

function renderOptionRow(option, depth = 0) {
  const indent = depth > 0 ? ` style="margin-left:${depth * 1.1}rem"` : '';
  if (option.kind === 'subcommand' || option.kind === 'subcommand-group') {
    return `<div class="opt-row opt-sub"${indent}>
      <span class="opt-name">${escapeHtml(option.name)}</span>
      <span class="opt-desc">${escapeHtml(option.description)}</span>
      ${(option.options || []).map((o) => renderOptionRow(o, depth + 1)).join('')}
    </div>`;
  }
  return `<div class="opt-row"${indent}>
    <span class="opt-name">${escapeHtml(option.name)}${option.required ? '<span class="opt-required" title="Obligatorio">*</span>' : ''}</span>
    <span class="opt-type">${escapeHtml(option.type)}</span>
    <span class="opt-desc">${escapeHtml(option.description)}${option.choices.length ? ` — opciones: ${option.choices.map(escapeHtml).join(', ')}` : ''}</span>
  </div>`;
}

function renderCommandCard(command) {
  const meta = CATEGORY_META[command.category] || { emoji: '❔', name: command.category };
  const searchBlob = `${command.name} ${command.description}`.toLowerCase();
  return `<article class="cmd-card" data-category="${escapeHtml(command.category)}" data-search="${escapeHtml(searchBlob)}">
    <button type="button" class="cmd-summary" aria-expanded="false">
      <span class="cmd-name">/${escapeHtml(command.name)}</span>
      <span class="cmd-desc">${escapeHtml(command.description)}</span>
      <span class="cmd-badge">${meta.emoji} ${escapeHtml(meta.name)}</span>
    </button>
    <div class="cmd-detail">
      ${command.options.length ? `<div class="opt-list">${command.options.map((o) => renderOptionRow(o)).join('')}</div>` : '<p class="cmd-meta-line">Sin opciones — se usa solo.</p>'}
      <div class="cmd-meta-line">
        ${command.requiredDiscordPermissions.length
          ? `Requiere permiso de Discord: ${command.requiredDiscordPermissions.map((p) => escapeHtml(formatPermissionLabel(p))).join(', ')}`
          : 'Sin restricción nativa de Discord — el acceso lo controla NEXO (moderador/administrador/dueño) o es de uso libre.'}
      </div>
      <div class="cmd-meta-line">${command.dmAllowed ? 'Puede usarse por mensaje directo.' : 'Solo dentro de un servidor.'}</div>
    </div>
  </article>`;
}

export function renderCommandsPage() {
  // 'voz' no tiene comando propio (feature 100% automática, ver website/data/features.js)
  // — un chip que siempre da "0 resultados" es peor que no mostrarlo.
  const categoryChips = Object.entries(CATEGORY_META)
    .filter(([id]) => id !== 'voz')
    .map(([id, meta]) => `<button type="button" class="chip" data-filter-category="${id}" aria-pressed="false">${meta.emoji} ${escapeHtml(meta.name)}</button>`)
    .join('');

  return `
<section class="tight">
  <div class="wrap">
    <div class="section-head" data-reveal>
      <span class="eyebrow">Referencia</span>
      <h1>Explorador de comandos</h1>
      <p>${COMMANDS.length} comandos, generados directo desde el código del bot${COMMANDS_GENERATED_AT ? ` — última actualización ${new Date(COMMANDS_GENERATED_AT).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}.</p>
    </div>
    <div class="cmd-search-row" data-reveal>
      <input type="search" id="cmd-search" class="cmd-search" placeholder="Buscar un comando..." aria-label="Buscar un comando">
      <span id="cmd-count" class="cmd-count" aria-live="polite">${COMMANDS.length} comandos</span>
    </div>
    <div class="chip-row" data-reveal role="group" aria-label="Filtrar por categoría">
      <button type="button" class="chip is-active" data-filter-category="" aria-pressed="true">Todas</button>
      ${categoryChips}
    </div>
    <div id="cmd-list" class="cmd-list" data-reveal>
      ${COMMANDS.map(renderCommandCard).join('')}
    </div>
    <p id="cmd-empty" class="cmd-empty" hidden>Ningún comando coincide con esa búsqueda.</p>
  </div>
</section>
<script>
(function () {
  var search = document.getElementById('cmd-search');
  var chips = document.querySelectorAll('.chip[data-filter-category]');
  var cards = document.querySelectorAll('.cmd-card');
  var countEl = document.getElementById('cmd-count');
  var emptyEl = document.getElementById('cmd-empty');
  var activeCategory = '';

  function applyFilter() {
    var term = (search.value || '').trim().toLowerCase();
    var visible = 0;
    cards.forEach(function (card) {
      var matchesCategory = !activeCategory || card.getAttribute('data-category') === activeCategory;
      var matchesTerm = !term || card.getAttribute('data-search').indexOf(term) !== -1;
      var show = matchesCategory && matchesTerm;
      card.hidden = !show;
      if (show) visible += 1;
    });
    countEl.textContent = visible + (visible === 1 ? ' comando' : ' comandos');
    emptyEl.hidden = visible !== 0;
  }

  search.addEventListener('input', applyFilter);
  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      chips.forEach(function (c) { c.classList.remove('is-active'); c.setAttribute('aria-pressed', 'false'); });
      chip.classList.add('is-active');
      chip.setAttribute('aria-pressed', 'true');
      activeCategory = chip.getAttribute('data-filter-category');
      applyFilter();
    });
  });

  cards.forEach(function (card) {
    var summary = card.querySelector('.cmd-summary');
    summary.addEventListener('click', function () {
      var open = card.classList.toggle('is-open');
      summary.setAttribute('aria-expanded', String(open));
    });
  });

  // Permite enlazar directo a una categoría (ej. desde /docs) con /commands?categoria=economia
  var presetCategory = new URLSearchParams(window.location.search).get('categoria');
  var presetChip = presetCategory && document.querySelector('.chip[data-filter-category="' + presetCategory + '"]');
  if (presetChip) presetChip.click();
})();
</script>`;
}
