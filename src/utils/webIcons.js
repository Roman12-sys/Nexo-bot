// Íconos SVG compartidos entre dashboard/ y website/ (2026-09-19) — reemplaza el emoji
// de UI "de interfaz" (headers, badges de estado, accesos rápidos) por el mismo set de
// Lucide que react-icons empaqueta bajo react-icons/lu. Este proyecto no usa React ni
// bundler (dashboard/website son Express + template literals a mano, decisión
// documentada en CLAUDE.md) — react-icons en sí (componentes JSX) no aplica acá. La
// equivalencia real es leer los SVG reales de `lucide-static` (MIT/ISC, sin build step,
// mismo criterio que website/ ya usa para servir sus fuentes .ttf locales) y devolver el
// markup tal cual, cacheado en memoria tras la primera lectura.
//
// QUÉ QUEDA AFUERA A PROPÓSITO: los emoji de CATEGORÍA de comandos (🧹 Moderación,
// 💰 Economía, 🎰 Casino, ⭐ Progresión, 🎲 Diversión, 🎭 Acción, 🎉 Sorteos, 📢 Anuncios,
// 🔊 Voz, ⚙️ Administración, ℹ️ Información) — website/data/categories.js documenta que
// son copia EXACTA de lo que un usuario ve en /help dentro de Discord, a propósito, para
// que el sitio nunca muestre un ícono distinto al que el bot realmente usa (Discord no
// puede renderizar un SVG arbitrario en un embed). Cualquier lugar que muestre esas
// mismas categorías (features.js, home.js, commands.js) se deja igual. Este módulo solo
// cubre chrome de interfaz sin ninguna obligación de parecerse a un embed de Discord.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ICONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../node_modules/lucide-static/icons');
const rawCache = new Map();

function readIconFile(name) {
  if (rawCache.has(name)) return rawCache.get(name);
  let raw;
  try {
    raw = readFileSync(path.join(ICONS_DIR, `${name}.svg`), 'utf8');
  } catch {
    raw = null; // nombre de ícono mal escrito — null-safe, nunca tira el proceso por esto
  }
  rawCache.set(name, raw);
  return raw;
}

// `size` en px — los SVG de lucide-static son 24x24 con stroke-width 2; achicar vía
// width/height es seguro (es vectorial). `aria-hidden` siempre true: en todo este
// proyecto un ícono va SIEMPRE pegado a una etiqueta de texto visible (nunca ícono solo
// reemplazando texto), así que el lector de pantalla ya tiene lo que necesita sin leer
// el SVG — evita duplicar información en vez de agregar un `aria-label` por ícono.
export function icon(name, { size = 16 } = {}) {
  const raw = readIconFile(name);
  if (!raw) return '';

  return raw
    .replace(/<!--.*?-->\s*/s, '')
    .replace(/class="[^"]*"/, 'class="icon"')
    .replace(/width="24"/, `width="${size}"`)
    .replace(/height="24"/, `height="${size}"`)
    .replace('<svg', '<svg aria-hidden="true" focusable="false"');
}

// Punto de estado (🟢/🟡/🔴/⚪ de antes) — un dot sólido, no un ícono de línea: es el
// patrón estándar para "operativo/advertencia/caído" (Ley de Jakob, cualquier status
// page real usa esto), y necesita heredar el color semántico real de cada estado
// (var(--status-ok) etc., ya definidos en webTheme.js) vía currentColor — un ícono de
// línea de Lucide no da esa lectura instantánea de un vistazo.
export function statusDot(size = 10) {
  return `<svg class="icon status-dot" width="${size}" height="${size}" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><circle cx="5" cy="5" r="5" fill="currentColor" /></svg>`;
}
