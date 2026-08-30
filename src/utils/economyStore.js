// MIGRADO A SUPABASE (antes: economy.json + economyTransactions.json). Toda función
// que antes era síncrona ahora es async — implica una llamada de red a Postgres.
// Cualquier caller tiene que hacer `await`.
import { supabase } from '../supabaseClient.js';
import { eventBus } from './eventBus.js'; // Event Engine — auditoría 2026-08-29, Parte 7/Fase 3

const TABLE = 'economy';
const TRANSACTIONS_TABLE = 'economy_transactions';

// La tabla usa snake_case; el resto del bot sigue trabajando con camelCase.
function rowToRecord(row) {
  if (!row) {
    return {
      balance: 0, lastDaily: 0, lastWork: 0, dailyStreak: 0, bank: 0, lastInterestTs: 0,
      lastRob: 0, lastRobbed: 0, lastCrime: 0, lastWeekly: 0, robShieldUntil: 0, inventory: {},
    };
  }
  return {
    balance: row.balance,
    lastDaily: row.last_daily,
    lastWork: row.last_work,
    // Filas viejas (creadas antes de agregar estas columnas) no las tienen todavía en el
    // objeto que devuelve Supabase si la migración correspondiente no corrió — 0 es "sin
    // banco/racha/robo/crimen/semanal todavía".
    dailyStreak: row.daily_streak || 0,
    bank: row.bank || 0,
    lastInterestTs: row.last_interest_ts || 0,
    lastRob: row.last_rob || 0,
    lastRobbed: row.last_robbed || 0,
    lastCrime: row.last_crime || 0,
    lastWeekly: row.last_weekly || 0,
    robShieldUntil: row.rob_shield_until || 0,
    // inventory viene como jsonb; por las dudas (fila vieja sin este campo) se
    // rellena vacío, mismo fallback que tenía getUserEconomy() con el JSON.
    inventory: row.inventory || {},
  };
}

function recordToRow(guildId, userId, record) {
  return {
    guild_id: guildId,
    user_id: userId,
    balance: record.balance,
    last_daily: record.lastDaily,
    last_work: record.lastWork,
    daily_streak: record.dailyStreak || 0,
    bank: record.bank || 0,
    last_interest_ts: record.lastInterestTs || 0,
    last_rob: record.lastRob || 0,
    last_crime: record.lastCrime || 0,
    last_weekly: record.lastWeekly || 0,
    last_robbed: record.lastRobbed || 0,
    rob_shield_until: record.robShieldUntil || 0,
    inventory: record.inventory || {},
  };
}

// Devuelve los datos de economía de un usuario puntual. Si nunca tuvo datos guardados,
// devolvemos un objeto "vacío" por defecto (así el resto del código no tiene que andar
// comprobando si existe o no).
export async function getUserEconomy(guildId, userId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('balance, last_daily, last_work, daily_streak, bank, last_interest_ts, last_rob, last_robbed, last_crime, last_weekly, rob_shield_until, inventory')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return rowToRecord(data);
}

// Guarda (o actualiza) los datos de economía de un usuario
export async function saveUserEconomy(guildId, userId, data) {
  const { error } = await supabase
    .from(TABLE)
    .upsert(recordToRow(guildId, userId, data), { onConflict: 'guild_id,user_id' });

  if (error) throw error;
}

// Suma (o resta, si "amount" es negativo) monedas al balance de un usuario.
//
// Usa la función SQL increment_balance (ver esquema) en vez de leer-sumar-guardar acá:
// esa función hace "balance = greatest(0, balance + amount)" en una sola sentencia
// atómica dentro de Postgres, así que dos operaciones para el mismo usuario casi
// simultáneas (ej. /give y /daily disparados en el mismo segundo) nunca se pisan —
// ninguna lee un valor "viejo" porque ninguna lee el valor por separado, el incremento
// se hace directamente en la base. Esto reemplaza el read-modify-write que tenía antes.
// QUÉ CAMBIÓ: emite COINS_EARNED cuando amount > 0.
// MOTIVO: auditoría 2026-08-29 (Fase 3, misiones) — en vez de agregar el emit a cada
// comando que da monedas (daily/work/crime/casino/pet/trivia/guess...), se centraliza
// acá, el único primitivo por el que pasan todas esas ganancias. amount<=0 (o meta de
// tipo admin_remove) nunca emite — evita que un ajuste de staff hacia abajo, o clampear
// a 0, cuenten como "ganaste monedas" para una misión.
// A propósito NO pasa por acá /give ni el robo exitoso de /rob (usan transfer_balance/
// rob_wallet, RPCs separadas) — es deliberado: contar transferencias entre usuarios como
// "ganancia" abriría la misma puerta de farmeo entre alts que ya vigila giveTracker.js.
export async function addBalance(guildId, userId, amount, meta) {
  const { data: newBalance, error } = await supabase.rpc('increment_balance', {
    p_guild_id: guildId,
    p_user_id: userId,
    p_amount: amount,
  });

  if (error) throw error;
  if (meta) await recordTransaction(guildId, userId, { ...meta, amount, balanceAfter: newBalance });
  if (amount > 0) await eventBus.emit('COINS_EARNED', { guildId, userId, amount });
  return newBalance; // devolvemos el nuevo balance, para poder mostrarlo enseguida
}

// Actualiza SOLO el cooldown de /daily o /work de un usuario (never toca balance/inventory).
// A diferencia de saveUserEconomy (que reescribe la fila entera con lo que se leyó al
// principio del comando), esto es un UPDATE de una sola columna: si el balance cambió
// por otro lado (ej. un /give) entre que se leyó y que se guardó el cooldown, acá no hay
// forma de pisarlo — solo se toca la columna del cooldown. Requiere que la fila ya
// exista (por eso siempre se llama DESPUÉS de addBalance, que la crea si hace falta).
const COOLDOWN_COLUMNS = { daily: 'last_daily', work: 'last_work', crime: 'last_crime', weekly: 'last_weekly' };

export async function setCooldown(guildId, userId, field, timestamp) {
  const column = COOLDOWN_COLUMNS[field];
  const { error } = await supabase
    .from(TABLE)
    .update({ [column]: timestamp })
    .eq('guild_id', guildId)
    .eq('user_id', userId);

  if (error) throw error;
}

// Igual que setCooldown pero para /daily puntualmente, que además de mover el cooldown
// necesita guardar la racha calculada (daily.js decide el número, esto solo lo persiste)
// — una sola escritura de 2 columnas en vez de 2 llamadas separadas.
export async function setDailyClaim(guildId, userId, { timestamp, streak }) {
  const { error } = await supabase
    .from(TABLE)
    .update({ last_daily: timestamp, daily_streak: streak })
    .eq('guild_id', guildId)
    .eq('user_id', userId);

  if (error) throw error;
}

// --- Banco: guarda plata "a salvo" (fuera de /rob), a cambio de un interés chico ---
// Depósito/retiro son transacciones atómicas (RPCs deposit_to_bank/withdraw_from_bank)
// por el mismo motivo que transfer_balance: mover plata entre dos columnas de la MISMA
// fila también necesita ser una sola sentencia, si no dos depósitos casi simultáneos
// del mismo usuario podrían leer el balance "viejo" y perder uno de los dos movimientos.
export async function depositToBank(guildId, userId, amount) {
  const { data, error } = await supabase.rpc('deposit_to_bank', {
    p_guild_id: guildId,
    p_user_id: userId,
    p_amount: amount,
    p_now: Date.now(),
  });
  if (error) {
    if (error.message?.includes('insufficient_funds')) {
      const insufficientError = new Error('insufficient_funds');
      insufficientError.code = 'insufficient_funds';
      throw insufficientError;
    }
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  await recordTransaction(guildId, userId, { type: 'bank_deposit', amount: -amount, balanceAfter: row.wallet, reason: 'Depósito al banco' });
  return { wallet: row.wallet, bank: row.bank };
}

export async function withdrawFromBank(guildId, userId, amount) {
  const { data, error } = await supabase.rpc('withdraw_from_bank', {
    p_guild_id: guildId,
    p_user_id: userId,
    p_amount: amount,
    p_now: Date.now(),
  });
  if (error) {
    if (error.message?.includes('insufficient_funds')) {
      const insufficientError = new Error('insufficient_funds');
      insufficientError.code = 'insufficient_funds';
      throw insufficientError;
    }
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  await recordTransaction(guildId, userId, { type: 'bank_withdraw', amount, balanceAfter: row.wallet, reason: 'Retiro del banco' });
  return { wallet: row.wallet, bank: row.bank };
}

// Interés simple (no compuesto), aplicado solo cuando el usuario mira /bank — no hay
// cron: se calcula acá con el tiempo transcurrido desde la última vez, tope de
// INTEREST_CAP_DAYS para que dejar la cuenta "olvidada" un año no genere un pago gigante
// de una sola vez. lastInterestTs === 0 (nunca se calculó) no paga nada la primera vez,
// solo arranca a contar desde ahí — mismo criterio que lastDaily === 0 en /daily.
const INTEREST_RATE_PER_DAY = 0.02;
const INTEREST_CAP_DAYS = 14;

export async function collectBankInterest(guildId, userId) {
  const record = await getUserEconomy(guildId, userId);
  const now = Date.now();

  if (record.lastInterestTs === 0 || record.bank === 0) {
    if (record.lastInterestTs === 0) {
      const { error: initError } = await supabase.from(TABLE).update({ last_interest_ts: now }).eq('guild_id', guildId).eq('user_id', userId);
      if (initError) throw initError;
    }
    return { interest: 0, bank: record.bank };
  }

  const daysElapsed = Math.min((now - record.lastInterestTs) / (24 * 60 * 60 * 1000), INTEREST_CAP_DAYS);
  const interest = Math.floor(record.bank * INTEREST_RATE_PER_DAY * daysElapsed);

  if (interest <= 0) return { interest: 0, bank: record.bank };

  const newBank = record.bank + interest;
  const { error } = await supabase
    .from(TABLE)
    .update({ bank: newBank, last_interest_ts: now })
    .eq('guild_id', guildId)
    .eq('user_id', userId);
  if (error) throw error;

  await recordTransaction(guildId, userId, { type: 'bank_interest', amount: interest, balanceAfter: record.balance, reason: `Interés (${daysElapsed.toFixed(1)} día(s))` });
  return { interest, bank: newBank };
}

// --- /rob: robar del wallet (nunca del banco) de otro usuario ---
// El % a robar y el tope se calculan DENTRO de la transacción atómica (RPC rob_wallet)
// sobre el balance real de la víctima en ese instante — así no hay ventana entre "leer
// cuánto tiene" y "robarle" donde el monto calculado quede desactualizado.
export async function robWallet(guildId, robberId, victimId, percent, maxAmount) {
  const { data, error } = await supabase.rpc('rob_wallet', {
    p_guild_id: guildId,
    p_robber_id: robberId,
    p_victim_id: victimId,
    p_percent: percent,
    p_max_amount: maxAmount,
  });
  if (error) {
    if (error.message?.includes('nothing_to_steal')) {
      const nothingError = new Error('nothing_to_steal');
      nothingError.code = 'nothing_to_steal';
      throw nothingError;
    }
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return { stolen: row.stolen, robberBalance: row.robber_balance, victimBalance: row.victim_balance };
}

export async function setRobCooldowns(guildId, { robberId, robberTimestamp, victimId, victimTimestamp }) {
  // RPC atómica (set_rob_cooldowns, ver schema.sql) en vez de dos UPDATE por
  // separado: si el robber quedaba con cooldown pero la víctima sin protección por un
  // fallo a mitad de camino, podía ser robada de nuevo al instante.
  const { error } = await supabase.rpc('set_rob_cooldowns', {
    p_guild_id: guildId,
    p_robber_id: robberId,
    p_robber_ts: robberTimestamp,
    p_victim_id: victimId,
    p_victim_ts: victimTimestamp,
  });
  if (error) throw error;
}

// Ítem de tienda type:'rob_shield' (ver buy.js) — mismo patrón que extendXpBoost en
// xpStore.js: extiende en vez de reemplazar, para no desperdiciar tiempo restante si ya
// tenía uno activo.
export async function extendRobShield(guildId, userId, durationMs) {
  const record = await getUserEconomy(guildId, userId);
  const now = Date.now();
  const newUntil = Math.max(record.robShieldUntil, now) + durationMs;

  const { error } = await supabase.from(TABLE).update({ rob_shield_until: newUntil }).eq('guild_id', guildId).eq('user_id', userId);
  if (error) throw error;
  return newUntil;
}

// Fija el balance de un usuario a un valor exacto (a diferencia de addBalance, que suma/resta).
// Lo usa el panel de staff para "establecer" una cantidad específica.
//
// A propósito NO usa saveUserEconomy (que reescribe la fila entera): el upsert de acá
// abajo solo incluye la columna "balance" en el payload, así Postgres solo actualiza
// ESA columna en el conflicto — si justo en el medio corre un /buy o un /daily
// concurrente que tocó inventory/last_daily/last_work, esta escritura no los pisa.
export async function setBalance(guildId, userId, amount, meta) {
  const before = await getUserEconomy(guildId, userId);
  const newBalance = Math.max(0, amount);

  const { error } = await supabase
    .from(TABLE)
    .upsert({ guild_id: guildId, user_id: userId, balance: newBalance }, { onConflict: 'guild_id,user_id' });
  if (error) throw error;

  if (meta) await recordTransaction(guildId, userId, { ...meta, amount: newBalance - before.balance, balanceAfter: newBalance });
  return newBalance;
}

// Descuenta "amount" del balance SOLO si alcanza, en una sola sentencia atómica (RPC
// deduct_balance_if_sufficient) — a diferencia de addBalance (que clampea a 0 y siempre
// "cobra" lo que haya, aunque no alcance), esto rechaza la operación entera si no hay
// fondos suficientes. Lo usa /buy: dos compras simultáneas del mismo usuario ya no
// pueden cobrar dos veces con un balance que solo alcanzaba para una.
export async function deductBalanceIfSufficient(guildId, userId, amount) {
  const { data: newBalance, error } = await supabase.rpc('deduct_balance_if_sufficient', {
    p_guild_id: guildId,
    p_user_id: userId,
    p_amount: amount,
  });

  if (error) {
    if (error.message?.includes('insufficient_funds')) {
      const insufficientError = new Error('insufficient_funds');
      insufficientError.code = 'insufficient_funds';
      throw insufficientError;
    }
    throw error;
  }
  return newBalance;
}

// Suma "qty" a un ítem puntual del inventario (jsonb) de forma atómica (RPC
// increment_inventory_item) — dos compras simultáneas del mismo ítem ya no pueden
// leer el mismo inventario "viejo" y pisarse la unidad que agregó la otra.
export async function incrementInventoryItem(guildId, userId, itemId, qty) {
  const { data: newInventory, error } = await supabase.rpc('increment_inventory_item', {
    p_guild_id: guildId,
    p_user_id: userId,
    p_item_id: itemId,
    p_qty: qty,
  });

  if (error) throw error;
  return newInventory;
}

// Transferencia atómica entre dos usuarios (usa el RPC transfer_balance): el chequeo de
// fondos, la resta y la suma pasan en UNA sola transacción de Postgres. Antes esto eran
// 2 llamadas independientes (una resta, una suma) con una ventana en el medio donde,
// si la segunda fallaba, la plata del emisor ya se había ido y el receptor nunca la
// recibía. Ahora, si no alcanza el balance, ni siquiera se descuenta nada: el RPC tira
// la excepción 'insufficient_funds' y ninguna de las dos partes se llega a ejecutar.
export async function transferBalance(guildId, senderId, receiverId, amount) {
  const { data, error } = await supabase.rpc('transfer_balance', {
    p_guild_id: guildId,
    p_sender_id: senderId,
    p_receiver_id: receiverId,
    p_amount: amount,
  });

  if (error) {
    if (error.message?.includes('insufficient_funds')) {
      const insufficientError = new Error('insufficient_funds');
      insufficientError.code = 'insufficient_funds';
      throw insufficientError;
    }
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return { senderBalance: row.sender_balance, receiverBalance: row.receiver_balance };
}

// Devuelve los datos de economía de TODOS los usuarios de un servidor, ordenados de
// mayor a menor balance (el orden lo hace Postgres). "limit" es opcional — /leaderboard
// solo necesita el top N.
export async function getGuildEconomy(guildId, { limit } = {}) {
  let query = supabase
    .from(TABLE)
    .select('user_id, balance, last_daily, last_work, daily_streak, bank, last_interest_ts, last_rob, last_robbed, last_crime, last_weekly, rob_shield_until, inventory')
    .eq('guild_id', guildId)
    .order('balance', { ascending: false });

  if (limit) query = query.limit(limit);

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map((row) => ({ userId: row.user_id, ...rowToRecord(row) }));
}

// --- Historial de transacciones ---
// Mismo propósito que antes (economyTransactions.json): un registro append-only de lo
// que le pasó al balance que ya vive en la tabla "economy". No es una economía paralela.
//
// A diferencia del JSON, acá NO se recorta a los últimos 200 por usuario — Postgres no
// tiene el problema de "un archivo que crece para siempre"; el límite se aplica solo
// al leer (getUserTransactions), no al guardar.

// Deja constancia de un movimiento. No toca el balance (eso ya lo hizo quien llama).
// type: 'daily' | 'work' | 'trivia' | 'guess' | 'purchase' | 'transfer_in' | 'transfer_out'
//       | 'admin_add' | 'admin_remove' | 'admin_set'
// actorId: quién causó el movimiento (por defecto, el mismo dueño del balance —
//          para acciones de staff se pasa explícitamente el id del moderador).
export async function recordTransaction(guildId, userId, { type, amount, balanceAfter, actorId, reason }) {
  const { error } = await supabase.from(TRANSACTIONS_TABLE).insert({
    guild_id: guildId,
    user_id: userId,
    type,
    amount,
    balance_after: balanceAfter,
    actor_id: actorId || userId,
    reason: reason || null,
  });

  if (error) throw error;
}

// Últimas compras del servidor de items puntuales por nombre (reason) — lo usa
// /economia-staff pendientes para listar compras de entrega MANUAL (cambio de apodo,
// mención en anuncio) sin tener que scrollear el canal de logs de economía a mano.
export async function getGuildPurchasesByReason(guildId, reasons, limit = 25, { onlyPending = false } = {}) {
  if (reasons.length === 0) return [];

  let query = supabase
    .from(TRANSACTIONS_TABLE)
    .select('id, user_id, reason, amount, delivered, created_at')
    .eq('guild_id', guildId)
    .eq('type', 'purchase')
    .in('reason', reasons)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (onlyPending) query = query.eq('delivered', false);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    reason: row.reason,
    amount: row.amount,
    delivered: row.delivered,
    timestamp: new Date(row.created_at).getTime(),
  }));
}

// /economia-staff pendientes: marca una compra de entrega manual como ya cumplida, para
// que deje de aparecer en la lista. No hay "desmarcar" — si fue un error, se vuelve a
// abrir el caso a mano (es un simple flag, no un historial de estados).
export async function markPurchaseDelivered(transactionId) {
  const { error } = await supabase.from(TRANSACTIONS_TABLE).update({ delivered: true }).eq('id', transactionId);
  if (error) throw error;
}

// Devuelve los últimos "limit" movimientos de un usuario, más reciente primero
export async function getUserTransactions(guildId, userId, limit = 10) {
  const { data, error } = await supabase
    .from(TRANSACTIONS_TABLE)
    .select('type, amount, balance_after, actor_id, reason, created_at')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data || []).map((row) => ({
    type: row.type,
    amount: row.amount,
    balanceAfter: row.balance_after,
    actorId: row.actor_id,
    reason: row.reason,
    timestamp: new Date(row.created_at).getTime(),
  }));
}
