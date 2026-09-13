import { describe, it, expect } from 'vitest';
import { buildCsvAttachment } from '../src/utils/csvExport.js';

// csvExport.js no tenía ningún test antes de la auditoría 2026-09-12, que encontró que
// no neutralizaba CSV/formula injection (OWASP) en valores que empiezan con =/+/-/@ —
// un motivo de warn como `=HYPERLINK(...)` se abre como fórmula real en Excel/Sheets.
function attachmentText(attachment) {
  // AttachmentBuilder guarda el buffer en .attachment — quitamos el BOM UTF-8 inicial
  // para comparar el contenido tal cual.
  return attachment.attachment.toString('utf-8').replace(/^﻿/, '');
}

describe('csvExport.js — mitigación de CSV/formula injection', () => {
  it('un valor que empieza con = se antepone con un apóstrofo (no queda como fórmula cruda)', () => {
    const att = buildCsvAttachment('x.csv', [{ key: 'motivo', header: 'Motivo' }], [
      { motivo: '=HYPERLINK("http://evil.com","click")' },
    ]);
    const text = attachmentText(att);

    expect(text).toContain("'=HYPERLINK");
    expect(text).not.toMatch(/(?<!')=HYPERLINK/);
  });

  it.each(['+1+1', '-1+1', '@SUM(1,1)', '\tmalicioso'])('también neutraliza un valor que empieza con "%s"', (value) => {
    const att = buildCsvAttachment('x.csv', [{ key: 'motivo', header: 'Motivo' }], [{ motivo: value }]);
    const text = attachmentText(att);

    expect(text).toContain(`'${value}`);
  });

  it('un motivo normal (sin prefijo de fórmula) no se toca', () => {
    const att = buildCsvAttachment('x.csv', [{ key: 'motivo', header: 'Motivo' }], [{ motivo: 'Spam en el chat general' }]);
    const text = attachmentText(att);

    expect(text).toContain('Motivo\nSpam en el chat general');
  });
});

describe('csvExport.js — escapeo normal (comas/comillas/saltos de línea)', () => {
  it('un valor con coma queda entre comillas', () => {
    const att = buildCsvAttachment('x.csv', [{ key: 'motivo', header: 'Motivo' }], [{ motivo: 'Insultos, spam' }]);
    expect(attachmentText(att)).toContain('"Insultos, spam"');
  });

  it('un valor con comillas dobles las duplica y lo envuelve entre comillas', () => {
    const att = buildCsvAttachment('x.csv', [{ key: 'motivo', header: 'Motivo' }], [{ motivo: 'Dijo "hola"' }]);
    expect(attachmentText(att)).toContain('"Dijo ""hola"""');
  });

  it('null/undefined se convierten en celda vacía, no en "null"/"undefined"', () => {
    const att = buildCsvAttachment('x.csv', [{ key: 'motivo', header: 'Motivo' }], [{ motivo: null }, { motivo: undefined }]);
    expect(attachmentText(att)).toBe('Motivo\n\n');
  });
});
