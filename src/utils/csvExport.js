// Helper genérico para armar un adjunto CSV a partir de filas de objetos. Sin
// dependencia externa — el formato es simple (comas + comillas dobles), no hace
// falta una librería para esto.
import { AttachmentBuilder } from 'discord.js';

function escapeCsvValue(value) {
  const str = value === null || value === undefined ? '' : String(value);
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
