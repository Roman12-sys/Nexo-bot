// Tuning de economía por servidor — núcleo (plan de ejecución 2026-09-15, P1 de Fase 4B
// evaluado y diferido a propósito hasta ahora). Fuente ÚNICA de los defaults globales Y
// de "valor efectivo" (override de guild_config si existe, si no el default) — usada
// tanto por los comandos (/daily /work /crime /rob, al aplicar) como por /config
// economia (al mostrar/validar), para que nunca diverjan entre "lo que se aplica" y "lo
// que se muestra". Un guild que nunca corre /config economia se comporta EXACTAMENTE
// igual que antes de esta fase — todos los overrides son `null` por defecto.
//
// Los porcentajes se guardan en guild_config como enteros 1-100 (más cómodo para un
// admin que tipear un float) — estas funciones los devuelven ya divididos por 100. Los
// comandos nunca hacen esa conversión ellos mismos.
export const DAILY_DEFAULT = { min: 100, max: 300 };
export const WORK_DEFAULT = { min: 50, max: 150 };
export const CRIME_DEFAULT = { min: 150, max: 400, successPercent: 60 };
export const ROB_DEFAULT = { successPercent: 40, stealPercentMin: 10, stealPercentMax: 25, finePercentMin: 5, finePercentMax: 15 };

export function getEffectiveDailyRange(cfg) {
  return { min: cfg.economy_daily_min ?? DAILY_DEFAULT.min, max: cfg.economy_daily_max ?? DAILY_DEFAULT.max };
}

export function getEffectiveWorkRange(cfg) {
  return { min: cfg.economy_work_min ?? WORK_DEFAULT.min, max: cfg.economy_work_max ?? WORK_DEFAULT.max };
}

export function getEffectiveCrimeConfig(cfg) {
  return {
    min: cfg.economy_crime_min ?? CRIME_DEFAULT.min,
    max: cfg.economy_crime_max ?? CRIME_DEFAULT.max,
    successChance: (cfg.economy_crime_success_percent ?? CRIME_DEFAULT.successPercent) / 100,
  };
}

export function getEffectiveRobConfig(cfg) {
  return {
    successChance: (cfg.economy_rob_success_percent ?? ROB_DEFAULT.successPercent) / 100,
    stealPercentMin: (cfg.economy_rob_steal_percent_min ?? ROB_DEFAULT.stealPercentMin) / 100,
    stealPercentMax: (cfg.economy_rob_steal_percent_max ?? ROB_DEFAULT.stealPercentMax) / 100,
    finePercentMin: (cfg.economy_rob_fine_percent_min ?? ROB_DEFAULT.finePercentMin) / 100,
    finePercentMax: (cfg.economy_rob_fine_percent_max ?? ROB_DEFAULT.finePercentMax) / 100,
  };
}

// "personalizado" vs "por defecto (X–Y)" — usado por buildConfigSummaryEmbed. rango es
// { min, max } (enteros) o { successChance } (0-1, ya convertido) según el sistema.
export function describeRange(min, max, isCustom) {
  return `${min.toLocaleString('es-ES')}–${max.toLocaleString('es-ES')}${isCustom ? ' (personalizado)' : ' (por defecto)'}`;
}

export function describePercent(chance01, isCustom) {
  return `${Math.round(chance01 * 100)}%${isCustom ? ' (personalizado)' : ' (por defecto)'}`;
}
