// Helper genérico para armar un adjunto CSV a partir de filas de objetos. Sin
// dependencia externa — el formato es simple (comas + comillas dobles), no hace
// falta una librería para esto.
import { AttachmentBuilder } from 'discord.js';

// Mitigación de CSV/formula injection (OWASP) — auditoría 2026-09-12: un valor que
// empiece con =/+/-/@ (o tab/CR) se abre como fórmula al abrirse en Excel/Sheets, ej.
// un motivo de warn tipo `=HYPERLINK("http://evil","click")`. Estos CSV los arma
// SIEMPRE staff (/economia-staff historial, /warns exportar), nunca un usuario común,
// pero el campo en sí (motivo) es texto libre — anteponer un apóstrofo lo neutraliza
// sin afectar la inmensa mayoría de valores reales (fechas, montos, tags, prosa normal).
const FORMULA_INJECTION_PREFIX = /^[=+\-@\t\r]/;

function escapeCsvValue(value) {
  let str = value === null || value === undefined ? '' : String(value);
  if (FORMULA_INJECTION_PREFIX.test(str)) str = `'${str}`;
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

// columns: [{ key, header }] — header es lo que aparece en la primera fila del CSV,
// key es la propiedad de cada objeto en "rows" que va en esa columna.
export function buildCsvAttachment(filename, columns, rows) {
  const headerLine = columns.map((c) => escapeCsvValue(c.header)).join(',');
  const lines = rows.map((row) => columns.map((c) => escapeCsvValue(row[c.key])).join(','));
  const csv = [headerLine, ...lines].join('\n');

  // BOM al principio para que Excel detecte UTF-8 y no rompa los acentos/emojis.
  const buffer = Buffer.from(`﻿${csv}`, 'utf-8');
  return new AttachmentBuilder(buffer, { name: filename });
}
