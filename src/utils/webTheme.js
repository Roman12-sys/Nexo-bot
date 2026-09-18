// Fuente única de los tokens de color compartidos entre dashboard/ y website/ — los dos
// procesos Express de solo-interfaz del proyecto. No pueden compartir estado en runtime
// (son servicios de Railway separados), pero sí pueden importar la misma constante en
// tiempo de build/render, que es lo que faltaba: cada uno tenía su propia paleta oscura
// "prima pero no idéntica" (fondo/borde con valores parecidos pero distintos, copiados a
// mano) — auditoría UX/UI (2026-09-18), hallazgos Importante "dos paletas oscuras primas
// pero no idénticas" y "dashboard sin tokens CSS — el sitio (más nuevo) sí los tiene".
//
// Se toma la paleta de website/layout.js como la de referencia (no un promedio a ciegas
// entre las dos) — es la que ya pasó una revisión real de contraste WCAG (Fase 5, ver
// WEB_TEXT_DIM abajo). dashboard/html.js migra a estos mismos valores.
import { BRAND_COLOR } from './embeds.js';

export const WEB_BG = '#0a0912';
export const WEB_BG_RAISED = '#12101c';
export const WEB_SURFACE = '#15121f';
export const WEB_BORDER = '#2a2440';
export const WEB_TEXT = '#ede9f7';
export const WEB_TEXT_MUTED = '#978fb4';
// #756e91 (valor original del sitio) daba 4.14:1 contra WEB_BG y hasta 3.86:1 contra
// WEB_SURFACE — por debajo del mínimo WCAG AA (4.5:1) para texto de tamaño normal, y
// este color se usa en textos chicos (badges, labels, fechas) que no califican como
// "texto grande" para bajar el umbral a 3:1. Corregido en la revisión de accesibilidad
// del sitio (Fase 5, medido con la fórmula de luminancia relativa de WCAG, no a ojo):
// 5.00:1 / 4.66:1 / 4.75:1 contra WEB_BG/WEB_SURFACE/WEB_BG_RAISED respectivamente.
// Nunca bajar de este valor sin volver a medir contraste real.
export const WEB_TEXT_DIM = '#837b9f';
// Mismo color de marca real que usan los embeds del bot y el dashboard desde siempre —
// nunca un segundo valor inventado para la web (ver el comentario histórico que ya
// tenía website/layout.js).
export const WEB_BRAND = BRAND_COLOR;
export const WEB_BRAND_SOFT = '#a284f7';

// Colores de estado (ok / advertencia / peligro) — auditoría UX/UI (2026-09-18),
// hallazgo Importante "colores de estado no coinciden entre Discord y dashboard/sitio":
// antes dashboard y sitio usaban una paleta tipo Tailwind (#4ade80/#facc15/#f87171) sin
// ninguna relación con los colores que el propio bot muestra para los mismos conceptos.
// Alineados acá a la misma familia semántica que ya usa Discord (SUCCESS_COLOR/
// WARN_COLOR/LOG_COLOR de embeds.js) — un solo criterio en las 3 superficies del
// proyecto (bot, dashboard, sitio), nunca 3 paletas para lo mismo.
//
// Contraste medido a mano (fórmula de luminancia relativa de WCAG) contra WEB_BG
// (#0a0912, el fondo más oscuro de los 3 reales — el peor caso):
//  - WEB_STATUS_OK (= SUCCESS_COLOR, #3DDC84): ~11.1:1 — sin baja de margen real frente
//    al #4ade80 anterior (~10-11:1), los dos muy por encima del mínimo AA (4.5:1).
//  - WEB_STATUS_WARN (= WARN_COLOR, #E9C46A): ~11.9:1 — leve baja frente al #facc15
//    anterior (~12.9:1), sigue muy por encima del mínimo AA.
//  - WEB_STATUS_DANGER (= LOG_COLOR, #E63946): ~4.75:1 — baja real frente al #f87171
//    anterior (~7.15:1). Sigue pasando el mínimo AA (4.5:1) pero con mucho menos
//    margen. NO verificado visualmente (sin herramienta de screenshot en este
//    entorno) — revisar a ojo en el dashboard/sitio reales una vez desplegado antes
//    de dar este valor puntual por cerrado del todo.
export const WEB_STATUS_OK = '#3DDC84';
export const WEB_STATUS_WARN = '#E9C46A';
export const WEB_STATUS_DANGER = '#E63946';
