// Ícono SVG (2026-09-19) — se probó reemplazando el emoji de UI en todo dashboard/ y
// website/ (Lucide, el mismo set que react-icons empaqueta bajo react-icons/lu; este
// proyecto no usa React ni bundler, así que la equivalencia real es leer los SVG reales
// de `lucide-static` en vez de importar componentes JSX). A pedido explícito del usuario
// se revirtió TODO a los emoji originales salvo un solo lugar: el badge "Pendiente de
// configurar" de dashboard/views.js (renderGuildList, pantalla "Tus servidores"). Este
// módulo se mantiene chico a propósito (una sola función) porque ya no tiene más que ese
// único consumidor — no hay necesidad de un catálogo de íconos que nadie más usa.
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
