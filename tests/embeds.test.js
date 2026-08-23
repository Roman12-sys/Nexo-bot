import { describe, it, expect } from 'vitest';
import { buildProgressBar, progressPercent } from '../src/utils/embeds.js';

describe('buildProgressBar', () => {
  it('barra vacía cuando current=0', () => {
    expect(buildProgressBar(0, 100, 10)).toBe('□□□□□□□□□□');
  });

  it('barra llena cuando current>=total', () => {
    expect(buildProgressBar(100, 100, 10)).toBe('■■■■■■■■■■');
  });

  it('barra a la mitad', () => {
    expect(buildProgressBar(50, 100, 10)).toBe('■■■■■□□□□□');
  });

  it('nunca se pasa de "length" segmentos aunque current > total', () => {
    const bar = buildProgressBar(500, 100, 10);
    expect(bar.length).toBe(10);
    expect(bar).toBe('■■■■■■■■■■');
  });

  it('total=0 no divide por cero, barra vacía', () => {
    expect(buildProgressBar(5, 0, 10)).toBe('□□□□□□□□□□');
  });
});

describe('progressPercent', () => {
  it('calcula el porcentaje redondeado hacia abajo', () => {
    expect(progressPercent(1, 3)).toBe(33);
    expect(progressPercent(50, 100)).toBe(50);
    expect(progressPercent(0, 100)).toBe(0);
  });

  it('total=0 devuelve 0 en vez de NaN/Infinity', () => {
    expect(progressPercent(5, 0)).toBe(0);
  });
});
