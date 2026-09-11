import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createSupabaseMock } from './helpers/supabaseMock.js';

// vi.mock se hoistea al tope del archivo — se declara acá arriba (no dentro del
// describe de más abajo que lo usa) para que la referencia a `supabaseMock` esté
// resuelta correctamente, mismo patrón que economyStore.test.js. Ninguno de los
// describes de simulación pura (más abajo) importa economyStore.js real, así que
// mockear supabaseClient acá no les afecta en nada.
const supabaseMock = createSupabaseMock();
vi.mock('../src/supabaseClient.js', () => ({ get supabase() { return supabaseMock; } }));

const { setBalance } = await import('../src/utils/economyStore.js');

// Auditoría adversarial round 2 (cierre de fase) — /economia-staff establecer.
//
// SEMÁNTICA DECIDIDA (no es un bug, es intencional): "establecer" fija el balance a un
// valor ABSOLUTO — balance final = amount, sin importar qué ganancia concurrente haya
// pasado en el medio (/daily, /give, /rob, casino, etc.). Esto es lo que un admin
// espera de un comando llamado "establecer": si fija el balance de alguien en 0 por un
// exploit y justo en el medio le entra un /daily, el admin espera que quede en 0
// igual — "preservar" esa ganancia socavaría silenciosamente la acción del admin, que
// es peor que el comportamiento actual. NO se cambió esa semántica.
//
// El bug REAL de concurrencia no estaba en el balance final (que ya era un set
// absoluto, correcto) sino en el valor "ANTES" que se usaba para calcular el delta que
// queda en economy_transactions (auditoría/historial/analítica): se leía en JS sin
// ningún lock, ANTES de escribir — un /give, /rob o /daily concurrente que cambiara el
// balance en esa ventana dejaba un delta INCORRECTO en el historial (nunca corrompía
// el balance real, pero sí ensuciaba el audit trail). El fix (RPC set_balance en
// schema.sql, con `for update` ANTES de leer "antes") garantiza que el valor
// reportado como "antes" sea siempre el real, sin importar qué otra operación
// económica haya corrido justo antes.
//
// LIMITACIÓN DOCUMENTADA (mismo criterio que economyLockOrdering.test.js): sin acceso
// a Postgres real en este entorno, estos tests simulan fielmente en JS el mismo
// algoritmo de locking de fila (for update, FIFO, con await real entre pasos) que las
// RPCs reales usan — no mockean la concurrencia, la reproducen con promesas
// genuinamente entrelazadas (mismo criterio que giveawayEngine.test.js contra
// asyncLock real). La verificación contra Postgres real requiere correr la migración
// y confirmarlo ahí — no se marca "PASS" sobre Postgres real desde acá.

function createRowLockManager() {
  const tail = new Map();
  function acquire(rowKey) {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const previous = tail.get(rowKey) || Promise.resolve();
    tail.set(rowKey, previous.then(() => held));
    return previous.then(() => release);
  }
  return { acquire };
}

// ---------- Simulación fiel de las RPCs reales, una por fila afectada ----------

// set_balance: bloquea LA fila objetivo, lee "antes" bajo el lock, escribe el valor
// absoluto, libera. Mismo algoritmo que schema.sql (una sola fila, sin problema de
// orden cruzado — a diferencia de transfer_balance/rob_wallet, "establecer" nunca
// toca una segunda cuenta).
async function simSetBalance(locks, ledger, userId, amount) {
  const release = await locks.acquire(userId);
  try {
    await Promise.resolve(); // punto de contención real dentro de la sección crítica
    const before = ledger.get(userId) ?? 0;
    const after = Math.max(0, amount);
    await Promise.resolve();
    ledger.set(userId, after);
    return { before, after };
  } finally {
    release();
  }
}

// increment_balance: modela /daily, /work, casino, etc. — suma/resta sobre el valor
// real bajo lock (mismo greatest(0, ...) que la RPC real).
async function simIncrementBalance(locks, ledger, userId, amount) {
  const release = await locks.acquire(userId);
  try {
    await Promise.resolve();
    const before = ledger.get(userId) ?? 0;
    const after = Math.max(0, before + amount);
    await Promise.resolve();
    ledger.set(userId, after);
    return after;
  } finally {
    release();
  }
}

// transfer_balance (YA CORREGIDA, Bloque 4): modela /give — bloquea ambas cuentas
// SIEMPRE por orden de user_id, nunca por rol emisor/receptor.
async function simTransferBalance(locks, ledger, senderId, receiverId, amount) {
  const [first, second] = senderId < receiverId ? [senderId, receiverId] : [receiverId, senderId];
  const releaseFirst = await locks.acquire(first);
  const releaseSecond = await locks.acquire(second);
  try {
    await Promise.resolve();
    const senderBalance = ledger.get(senderId) ?? 0;
    if (senderBalance < amount) return { ok: false };
    ledger.set(senderId, senderBalance - amount);
    await Promise.resolve();
    ledger.set(receiverId, (ledger.get(receiverId) ?? 0) + amount);
    return { ok: true, senderBalance: ledger.get(senderId), receiverBalance: ledger.get(receiverId) };
  } finally {
    releaseSecond();
    releaseFirst();
  }
}

// rob_wallet (YA CORREGIDA, Bloque 4): modela /rob — mismo criterio de orden.
async function simRobWallet(locks, ledger, robberId, victimId, amount) {
  const [first, second] = robberId < victimId ? [robberId, victimId] : [victimId, robberId];
  const releaseFirst = await locks.acquire(first);
  const releaseSecond = await locks.acquire(second);
  try {
    await Promise.resolve();
    const victimBalance = ledger.get(victimId) ?? 0;
    const stolen = Math.min(amount, victimBalance);
    ledger.set(victimId, victimBalance - stolen);
    await Promise.resolve();
    ledger.set(robberId, (ledger.get(robberId) ?? 0) + stolen);
    return { stolen };
  } finally {
    releaseSecond();
    releaseFirst();
  }
}

function withTimeout(promise, ms) {
  let timedOut = false;
  const timeout = new Promise((resolve) => setTimeout(() => { timedOut = true; resolve('TIMED_OUT'); }, ms));
  return Promise.race([promise, timeout]).then((result) => ({ result, timedOut }));
}

describe('set_balance — casos básicos (unitarios, sin concurrencia)', () => {
  const locks = createRowLockManager();
  let ledger;
  beforeEach(() => { ledger = new Map([['user-1', 750]]); });

  it('1) establecer balance normalmente', async () => {
    const { before, after } = await simSetBalance(locks, ledger, 'user-1', 1200);
    expect(before).toBe(750);
    expect(after).toBe(1200);
    expect(ledger.get('user-1')).toBe(1200);
  });

  it('2) establecer balance a 0', async () => {
    const { after } = await simSetBalance(locks, ledger, 'user-1', 0);
    expect(after).toBe(0);
    expect(ledger.get('user-1')).toBe(0);
  });

  it('2b) un monto negativo se clampea a 0 (mismo greatest(0,...) que el resto de la economía)', async () => {
    const { after } = await simSetBalance(locks, ledger, 'user-1', -999);
    expect(after).toBe(0);
  });

  it('3) establecer balance a un valor alto', async () => {
    const { after } = await simSetBalance(locks, ledger, 'user-1', 10_000_000);
    expect(after).toBe(10_000_000);
    expect(ledger.get('user-1')).toBe(10_000_000);
  });
});

describe('set_balance bajo concurrencia real con otras mutaciones de economía', () => {
  it('4) concurrente con /give: el "antes" que reporta set_balance es el valor REAL post-give, nunca el stale pre-give', async () => {
    const locks = createRowLockManager();
    const ledger = new Map([['user-U', 500], ['user-W', 0]]);

    // Arrancan "casi simultáneas": el /give (U le da 200 a W) se dispara PRIMERO en el
    // stack síncrono — por cómo se registran los locks (ver economyLockOrdering.test.js),
    // eso le garantiza a /give ganar la fila de U primero, y a /economia-staff
    // establecer quedar detrás en la cola de ESA MISMA fila — mismo tipo de
    // entrelazado real (no mockeado) que el resto de los tests de concurrencia del
    // proyecto.
    const give = simTransferBalance(locks, ledger, 'user-U', 'user-W', 200);
    const set = simSetBalance(locks, ledger, 'user-U', 1000);

    const { timedOut, result } = await withTimeout(Promise.all([give, set]), 500);
    expect(timedOut).toBe(false);
    const [giveResult, setResult] = result;

    expect(giveResult.ok).toBe(true);
    // El /give se resolvió PRIMERO (ganó la cola de la fila de U) — dejó a U en 300.
    expect(giveResult.senderBalance).toBe(300);
    expect(ledger.get('user-W')).toBe(200);

    // El punto que antes era un bug real: "antes" tiene que ser 300 (el valor
    // verdadero justo antes del set, YA con el /give aplicado) — nunca 500 (el valor
    // stale de antes de que arrancara el /give). Con la implementación vieja
    // (lectura en JS sin lock), esto podía reportar 500 y dejar un delta de +500 en
    // economy_transactions cuando el salto real fue de +700.
    expect(setResult.before).toBe(300);
    expect(setResult.after).toBe(1000);

    // Balance final: la semántica de "establecer" es absoluta a propósito — el /give
    // ya impactó a W (200, real, no se pierde), pero U termina en el valor que el
    // admin pidió, sin importar el /give — comportamiento intencional, no un bug.
    expect(ledger.get('user-U')).toBe(1000);
  });

  it('5) concurrente con /rob (víctima = usuario que se está estableciendo): "antes" refleja el robo ya aplicado', async () => {
    const locks = createRowLockManager();
    const ledger = new Map([['user-U', 1000], ['user-robber', 0]]);

    const rob = simRobWallet(locks, ledger, 'user-robber', 'user-U', 300);
    const set = simSetBalance(locks, ledger, 'user-U', 5000);

    const { timedOut, result } = await withTimeout(Promise.all([rob, set]), 500);
    expect(timedOut).toBe(false);
    const [robResult, setResult] = result;

    expect(robResult.stolen).toBe(300);
    expect(ledger.get('user-robber')).toBe(300);
    // El robo se aplicó ANTES del set (mismo criterio de orden de registro que el
    // test anterior) — dejó a U en 700 antes de que el set lo pisara.
    expect(setResult.before).toBe(700);
    expect(setResult.after).toBe(5000);
    expect(ledger.get('user-U')).toBe(5000);
  });

  it('6) concurrente con otra mutación de economía (increment_balance, ej. /daily): "antes" sigue siendo exacto', async () => {
    const locks = createRowLockManager();
    const ledger = new Map([['user-U', 100]]);

    const daily = simIncrementBalance(locks, ledger, 'user-U', 200); // /daily paga 200
    const set = simSetBalance(locks, ledger, 'user-U', 0); // staff resetea a 0 (ej. exploit)

    const { timedOut, result } = await withTimeout(Promise.all([daily, set]), 500);
    expect(timedOut).toBe(false);
    const [dailyResult, setResult] = result;

    expect(dailyResult).toBe(300); // /daily se aplicó primero: 100+200
    expect(setResult.before).toBe(300); // el set vio el balance YA con el /daily aplicado
    expect(setResult.after).toBe(0);
    expect(ledger.get('user-U')).toBe(0); // el admin ganó la última palabra, como se espera
  });

  it('7) resultado final consistente: dos set_balance concurrentes sobre el mismo usuario nunca corrompen el estado (último en la cola gana, de forma determinística)', async () => {
    const locks = createRowLockManager();
    const ledger = new Map([['user-U', 50]]);

    const setA = simSetBalance(locks, ledger, 'user-U', 111);
    const setB = simSetBalance(locks, ledger, 'user-U', 999);

    const { timedOut, result } = await withTimeout(Promise.all([setA, setB]), 500);
    expect(timedOut).toBe(false);
    const [resultA, resultB] = result;

    // setA se procesó primero (encoló primero) con "antes"=50; setB, encolado
    // detrás, vio "antes"=111 (el resultado de setA) — nunca un "antes" inventado o
    // mezclado entre ambos.
    expect(resultA).toEqual({ before: 50, after: 111 });
    expect(resultB).toEqual({ before: 111, after: 999 });
    expect(ledger.get('user-U')).toBe(999); // el último en aplicarse es el que queda
  });

  it('8) sin pérdida silenciosa de fondos: el /give en curso durante un set en OTRA cuenta nunca pierde ni duplica el monto transferido', async () => {
    const locks = createRowLockManager();
    // El set toca a un tercer usuario totalmente ajeno a la transferencia — no
    // debería haber ninguna interacción entre las dos filas.
    const ledger = new Map([['user-A', 500], ['user-B', 500], ['user-otro', 10]]);

    const give = simTransferBalance(locks, ledger, 'user-A', 'user-B', 200);
    const set = simSetBalance(locks, ledger, 'user-otro', 999);

    const { timedOut, result } = await withTimeout(Promise.all([give, set]), 500);
    expect(timedOut).toBe(false);
    const [giveResult] = result;

    expect(giveResult.ok).toBe(true);
    // Conservación total entre A y B: nada se creó ni se perdió en la transferencia.
    expect(ledger.get('user-A') + ledger.get('user-B')).toBe(1000);
    expect(ledger.get('user-A')).toBe(300);
    expect(ledger.get('user-B')).toBe(700);
    // El set de la cuenta ajena no interfirió en absoluto.
    expect(ledger.get('user-otro')).toBe(999);
  });
});

// ---------- Verificación de wiring real (economyStore.js -> RPC set_balance) ----------
// A diferencia de los tests de arriba (simulación fiel del algoritmo de locking, sin
// Postgres real disponible en este entorno), esto SÍ ejercita el código real de
// producción — solo mockea la respuesta de Supabase, mismo criterio que el resto de
// economyStore.test.js.
describe('economyStore.setBalance — usa la RPC set_balance (wiring real)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMock.rpc.mockReset();
  });

  it('llama a la RPC set_balance (no un upsert directo) y registra el delta REAL que devuelve Postgres', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: [{ balance_before: 300, balance_after: 1000 }], error: null });
    const insert = supabaseMock.getBuilder('economy_transactions').insert;

    const result = await setBalance('guild-1', 'user-U', 1000, { type: 'admin_set', actorId: 'staff-1', reason: 'ajuste' });

    expect(supabaseMock.rpc).toHaveBeenCalledWith('set_balance', { p_guild_id: 'guild-1', p_user_id: 'user-U', p_amount: 1000 });
    expect(result).toBe(1000);
    // amount = 1000 - 300 = 700, NUNCA calculado sobre un valor leído aparte en JS.
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ type: 'admin_set', amount: 700, balance_after: 1000 }));
  });
});
