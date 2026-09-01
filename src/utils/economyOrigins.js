// Clasificación centralizada de "de dónde vino esto" para economía y XP — Fase A de la
// segunda auditoría (2026-08-30). Antes de esto, COINS_EARNED/XP_GAINED trataban
// cualquier monto positivo como "actividad orgánica del usuario": un ajuste de staff
// (/economia-staff, /xp) o el payout BRUTO de un juego de casino contaban igual que un
// /daily para las misiones "ganá monedas" y para guild_daily_stats.money_created/
// xp_distributed. economía ya tenía `meta.type` y XP ya tenía `extra.source` para
// identificar el origen — ninguno de los dos se usaba con ese fin. Este archivo no
// renombra ninguno de los dos campos (tocar economyStore.js/xpStore.js entero por una
// convención de nombres no valía el riesgo) — les agrega un tercer concepto común,
// `origin`, que las dos rutas comparten:
//
//  - 'activity' → el usuario hizo algo (mensaje, voz, /daily, /work, /crime, /trivia,
//    /guess, vender un ítem, pelea de mascota). Cuenta para misiones Y para
//    money_created/xp_distributed.
//  - 'reward'   → recompensa de un sistema de progresión (pagar una misión). Es plata
//    nueva de verdad (cuenta para money_created), pero NO cuenta para el progreso de
//    OTRA misión — si contara, pagar una misión podría hacer avanzar otra en cadena
//    (COINS_EARNED → misión → recompensa → addBalance → COINS_EARNED...).
//  - 'stake'    → el usuario arriesgó plata propia para ganar esto (casino, caja
//    misteriosa). El monto que le llega a addBalance/addXp es el PAGO BRUTO, no la
//    ganancia neta — quien mejor conoce cuánto se apostó (casinoHelpers.js, buy.js) debe
//    pasar `meta.netGain` con la ganancia real (payout - apuesta/precio). Misiones y
//    analítica cuentan el neto, nunca el bruto.
//  - 'admin'    → ajuste de staff. No es actividad del usuario; no cuenta para nada
//    orgánico.
//
// Un `type`/`source` no listado acá cae en 'activity' por defecto — mismo comportamiento
// que existía antes de esta fase (todo positivo contaba), para que un tipo nuevo que
// alguien agregue después no quede excluido en silencio de las métricas.
const ECONOMY_ORIGIN_BY_TYPE = {
  daily: 'activity',
  work: 'activity',
  weekly: 'activity',
  crime_win: 'activity',
  guess: 'activity',
  trivia: 'activity',
  pet_battle_win: 'activity',
  sell: 'activity',
  mission: 'reward',
  gamble_win: 'stake',
  mystery_box: 'stake',
  admin_add: 'admin',
  // Reembolso automático de /buy cuando el rol de un ítem ya no existe (ver buy.js) —
  // no es actividad orgánica del usuario, es una corrección del sistema. Agregado Fase
  // 2B, sección 11 — sin esto caía en 'activity' por defecto y contaba como si el
  // usuario hubiera "ganado" esas monedas.
  purchase_refund: 'admin',
};

export function resolveEarningOrigin(type) {
  return ECONOMY_ORIGIN_BY_TYPE[type] || 'activity';
}

const XP_ORIGIN_BY_SOURCE = {
  message: 'activity',
  voice: 'activity',
  trivia: 'activity',
  admin: 'admin',
};

export function resolveXpOrigin(source) {
  return XP_ORIGIN_BY_SOURCE[source] || 'activity';
}

// Sumideros reales YA existentes (ver CLAUDE.md, sección "Economía") — la multa de
// /crime se destruye (no va a nadie) y el precio de una compra en /shop tampoco vuelve a
// nadie (a diferencia de /rob, cuya multa es una transferencia a la víctima, nunca una
// destrucción). Deliberadamente NO incluye apuestas de casino perdidas: separarlas del
// payout bruto tocaría el flujo central de casinoHelpers.js, fuera del alcance de esta
// fase — el house edge de slots/ruleta sigue actuando como sumidero implícito no medido,
// igual que antes de este cambio.
const DESTRUCTIVE_TYPES = new Set(['crime_fine', 'purchase']);

export function isDestructiveType(type) {
  return DESTRUCTIVE_TYPES.has(type);
}
