import { describe, it, expect } from 'vitest';
import {
  DAILY_DEFAULT,
  WORK_DEFAULT,
  CRIME_DEFAULT,
  ROB_DEFAULT,
  getEffectiveDailyRange,
  getEffectiveWorkRange,
  getEffectiveCrimeConfig,
  getEffectiveRobConfig,
} from '../src/utils/economyTuning.js';

// Tuning de economía por servidor (plan de ejecución 2026-09-15) — única fuente de
// verdad de "valor efectivo" (override de guild_config si existe, si no el default
// global), usada tanto por /daily /work /crime /rob (aplicar) como por /config economia
// (mostrar/validar). Un cfg sin ningún override (guild que nunca corrió /config
// economia) tiene que devolver EXACTAMENTE los defaults de siempre.

describe('getEffectiveDailyRange', () => {
  it('sin override: devuelve el default global', () => {
    expect(getEffectiveDailyRange({})).toEqual(DAILY_DEFAULT);
  });

  it('con override completo: lo usa en vez del default', () => {
    expect(getEffectiveDailyRange({ economy_daily_min: 10, economy_daily_max: 20 })).toEqual({ min: 10, max: 20 });
  });

  it('override parcial (solo uno de los dos): el otro cae al default', () => {
    expect(getEffectiveDailyRange({ economy_daily_min: 10 })).toEqual({ min: 10, max: DAILY_DEFAULT.max });
  });
});

describe('getEffectiveWorkRange', () => {
  it('sin override: devuelve el default global', () => {
    expect(getEffectiveWorkRange({})).toEqual(WORK_DEFAULT);
  });

  it('con override: lo usa', () => {
    expect(getEffectiveWorkRange({ economy_work_min: 5, economy_work_max: 15 })).toEqual({ min: 5, max: 15 });
  });
});

describe('getEffectiveCrimeConfig', () => {
  it('sin override: devuelve el default global, con successChance ya convertido a 0-1', () => {
    expect(getEffectiveCrimeConfig({})).toEqual({ min: CRIME_DEFAULT.min, max: CRIME_DEFAULT.max, successChance: 0.6 });
  });

  it('con override: usa esos valores, porcentaje dividido por 100', () => {
    expect(getEffectiveCrimeConfig({ economy_crime_min: 1, economy_crime_max: 2, economy_crime_success_percent: 75 })).toEqual({
      min: 1,
      max: 2,
      successChance: 0.75,
    });
  });
});

describe('getEffectiveRobConfig', () => {
  it('sin override: devuelve el default global, todo ya convertido a 0-1', () => {
    expect(getEffectiveRobConfig({})).toEqual({
      successChance: 0.4,
      stealPercentMin: 0.1,
      stealPercentMax: 0.25,
      finePercentMin: 0.05,
      finePercentMax: 0.15,
    });
  });

  it('con override completo: usa esos valores', () => {
    const cfg = {
      economy_rob_success_percent: 90,
      economy_rob_steal_percent_min: 1,
      economy_rob_steal_percent_max: 2,
      economy_rob_fine_percent_min: 3,
      economy_rob_fine_percent_max: 4,
    };
    expect(getEffectiveRobConfig(cfg)).toEqual({
      successChance: 0.9,
      stealPercentMin: 0.01,
      stealPercentMax: 0.02,
      finePercentMin: 0.03,
      finePercentMax: 0.04,
    });
  });
});
