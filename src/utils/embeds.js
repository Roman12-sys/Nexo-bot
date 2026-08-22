export const BRAND_NAME = 'Nexo Bot';
export const BRAND_COLOR = '#7F5AF0';
export const LOG_COLOR = '#E63946';

// Barra de progreso tipo [■■■■■■□□□□] usada por /nivel para mostrar el avance
// hacia el siguiente nivel de XP. length = cantidad de segmentos totales.
export function buildProgressBar(current, total, length = 12) {
  const ratio = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0;
  const filled = Math.round(ratio * length);
  return `${'■'.repeat(filled)}${'□'.repeat(length - filled)}`;
}

export function progressPercent(current, total) {
  return total > 0 ? Math.floor((current / total) * 100) : 0;
}
