import { vi, describe, it, expect } from 'vitest';

// xpStore.js importa supabaseClient.js a nivel de módulo, que a su vez requiere las
// variables de entorno de Supabase (config.js tira si faltan). Se mockea para poder
// testear las fórmulas puras de nivel/XP sin necesitar un .env real ni red.
vi.mock('../src/supabaseClient.js', () => ({ supabase: {} }));

const { xpRequiredForLevel, getLevelProgress, totalXpForLevel } = await import('../src/utils/xpStore.js');

describe('xpRequiredForLevel', () => {
  it('sube con el nivel (curva no lineal)', () => {
    expect(xpRequiredForLevel(0)).toBe(100);
    expect(xpRequiredForLevel(1)).toBe(155);
    expect(xpRequiredForLevel(10)).toBe(1100);
  });
});

describe('totalXpForLevel / getLevelProgress son inversas', () => {
  it('la XP total para alcanzar un nivel, evaluada con getLevelProgress, da exactamente ese nivel con 0 XP de sobra', () => {
    for (const level of [0, 1, 5, 10, 25]) {
      const totalXp = totalXpForLevel(level);
      const progress = getLevelProgress(totalXp);
      expect(progress.level).toBe(level);
      expect(progress.currentLevelXp).toBe(0);
    }
  });

  it('un XP menos que lo necesario para el próximo nivel no sube de nivel', () => {
    const xpForLevel5 = totalXpForLevel(5);
    const progress = getLevelProgress(xpForLevel5 - 1);
    expect(progress.level).toBe(4);
  });

  it('totalXp=0 es nivel 0', () => {
    expect(getLevelProgress(0)).toMatchObject({ level: 0, currentLevelXp: 0 });
  });

  it('xpForNextLevel siempre coincide con xpRequiredForLevel del nivel actual', () => {
    const progress = getLevelProgress(1234);
    expect(progress.xpForNextLevel).toBe(xpRequiredForLevel(progress.level));
  });
});
