import { describe, it, expect } from 'vitest';
import { modeFromRecord, describeMode } from '../src/utils/tempVoicePanel.js';

describe('modeFromRecord', () => {
  it('"pública bloqueada" es la única combinación type+locked que se colapsa a un modo propio', () => {
    expect(modeFromRecord({ type: 'public', locked: true })).toBe('public_locked');
  });

  it('el resto de los modos no dependen de "locked"', () => {
    expect(modeFromRecord({ type: 'public', locked: false })).toBe('public');
    expect(modeFromRecord({ type: 'private', locked: true })).toBe('private');
    expect(modeFromRecord({ type: 'invite_only', locked: false })).toBe('invite_only');
  });
});

describe('describeMode', () => {
  it('devuelve una etiqueta legible para cada modo conocido', () => {
    expect(describeMode({ type: 'private', locked: false })).toContain('Privada');
    expect(describeMode({ type: 'public', locked: true })).toContain('bloqueada');
  });

  it('un type desconocido no revienta, devuelve el type crudo', () => {
    expect(describeMode({ type: 'algo_raro', locked: false })).toBe('algo_raro');
  });
});
