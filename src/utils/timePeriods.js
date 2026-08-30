// Frontera única de "qué es hoy" (medianoche UTC) para todo el bot — Fase A de la
// segunda auditoría (2026-08-30) detectó que missionsStore.js (getDailyPeriodStart, en
// epoch-ms para aritmética de period_start bigint) y guildDailyStatsStore.js (todayUTC,
// en string ISO para la columna `date` real de Postgres) calculaban el mismo límite por
// separado, en dos archivos. No representan cosas distintas — es la misma medianoche UTC
// en dos formatos porque cada tabla usa un tipo de columna distinto (bigint vs date). Este
// archivo es el único lugar que decide dónde cae esa frontera; cada store solo la formatea
// a lo que su columna necesita. No cambia ningún comportamiento existente: es exactamente
// la cuenta que las dos hacían antes por separado.
export const DAY_MS = 24 * 60 * 60 * 1000;

export function utcMidnightMs(now = Date.now()) {
  return Math.floor(now / DAY_MS) * DAY_MS;
}

export function utcDateString(now = Date.now()) {
  return new Date(utcMidnightMs(now)).toISOString().slice(0, 10);
}
