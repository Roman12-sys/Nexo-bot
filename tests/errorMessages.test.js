import { describe, it, expect } from 'vitest';
import { describeError } from '../src/utils/errorMessages.js';

describe('describeError', () => {
  it('un código de Discord conocido (50013, permisos) devuelve un mensaje específico', () => {
    const error = { code: 50013, message: 'Missing Permissions' };
    expect(describeError(error, '❌ genérico')).toMatch(/permiso/i);
  });

  it('un código desconocido devuelve el fallback tal cual', () => {
    const error = { code: 999999, message: 'algo raro' };
    expect(describeError(error, '❌ genérico')).toBe('❌ genérico');
  });

  it('un error sin .code (no viene de la API de Discord) devuelve el fallback', () => {
    const error = new Error('fallo de red');
    expect(describeError(error, '❌ genérico')).toBe('❌ genérico');
  });

  it('sin error en absoluto (undefined) devuelve el fallback, no revienta', () => {
    expect(describeError(undefined, '❌ genérico')).toBe('❌ genérico');
  });
});
