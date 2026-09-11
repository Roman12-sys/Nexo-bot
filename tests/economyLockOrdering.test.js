import { describe, it, expect } from 'vitest';

// Auditoría adversarial round 2, Bloque 4 — transfer_balance/rob_wallet bloqueaban las
// dos filas de `economy` que tocan en un orden fijo por ROL (emisor->receptor,
// víctima->robber), no por identidad de cuenta. Dos operaciones cruzadas entre el mismo
// par de usuarios al mismo tiempo (A->B y B->A, o /give cruzado con /rob) podían tomar
// los locks en orden opuesto y deadlockear en Postgres (40P01). El fix (ver
// schema.sql / migration_2026_09_10_concurrency_hardening.sql) ordena SIEMPRE la
// adquisición por user_id ascendente, nunca por rol.
//
// LIMITACIÓN DOCUMENTADA A PROPÓSITO: este entorno de tests no tiene acceso a una
// instancia real de Postgres (los tests del proyecto mockean Supabase vía
// tests/helpers/supabaseMock.js — nunca pegan a una base real, ver CLAUDE.md sección
// Testing). No se puede reproducir un deadlock REAL de Postgres (40P01) desde acá. Lo
// que este archivo SÍ hace es simular fielmente, en JS, el mismo algoritmo de
// adquisición de locks de fila que corre dentro de cada función PL/pgSQL (lock
// exclusivo por fila, FIFO, con await real entre "tomar el lock de la primera fila" y
// "tomar el lock de la segunda") — replica el ALGORITMO de orden de bloqueo bit a bit,
// no el motor de Postgres. Esto permite demostrar, con evidencia real de concurrencia
// (nunca mockeada: dos ejecuciones async genuinamente entrelazadas, mismo criterio que
// giveawayEngine.test.js usa contra asyncLock.js real), que el orden VIEJO (por rol)
// se traba indefinidamente bajo el patrón cruzado A->B/B->A, mientras que el orden
// NUEVO (por user_id) siempre completa. La verificación de que la RPC real en
// Postgres efectivamente no deadlockea más requiere correr
// migration_2026_09_10_concurrency_hardening.sql contra Supabase y confirmarlo ahí —
// no se puede marcar "PASS" sobre Postgres real desde este test, y no se lo marca.

// ---------- Simulación de locks de fila (FIFO exclusivo por rowKey) ----------
function createRowLockManager() {
  const tail = new Map(); // rowKey -> promise que se resuelve cuando el lock queda libre

  // Devuelve una función `release` que hay que llamar para soltar el lock — mismo
  // patrón que un `FOR UPDATE` sostenido hasta el commit/rollback de la transacción.
  function acquire(rowKey) {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const previous = tail.get(rowKey) || Promise.resolve();
    tail.set(rowKey, previous.then(() => held));
    return previous.then(() => release);
  }

  return { acquire };
}

// ---------- Dos algoritmos de orden de bloqueo ----------

// VIEJO: bloquea siempre "primera cuenta del rol" -> "segunda cuenta del rol" — para
// transfer_balance eso es emisor->receptor; para rob_wallet, víctima->robber. Mismo
// código que corría en producción antes de esta fase. Libera sus propios locks al
// terminar (simula el COMMIT de la transacción) — si nunca llega a adquirir el
// segundo lock, nunca llega a esta parte, que es justo el punto del test de deadlock.
async function oldOrderTransfer(locks, senderId, receiverId) {
  const releaseSender = await locks.acquire(senderId);
  const releaseReceiver = await locks.acquire(receiverId);
  await Promise.resolve(); // trabajo simulado dentro de la transacción
  releaseReceiver();
  releaseSender();
  return true;
}

// NUEVO: bloquea SIEMPRE por identidad de cuenta (user_id ascendente), sin importar el
// rol de cada una en la llamada — el fix real de schema.sql. Mismo criterio de
// auto-liberación que oldOrderTransfer.
async function newOrderTransfer(locks, idA, idB) {
  const [first, second] = idA < idB ? [idA, idB] : [idB, idA];
  const releaseFirst = await locks.acquire(first);
  const releaseSecond = await locks.acquire(second);
  await Promise.resolve();
  releaseSecond();
  releaseFirst();
  return true;
}

function withTimeout(promise, ms) {
  let timedOut = false;
  const timeout = new Promise((resolve) => setTimeout(() => { timedOut = true; resolve('TIMED_OUT'); }, ms));
  return Promise.race([promise, timeout]).then((result) => ({ result, timedOut }));
}

describe('Orden de adquisición de locks — transfer A<->B cruzado', () => {
  it('orden VIEJO (por rol): A->B y B->A simultáneos NUNCA completan los dos (deadlock real, no mockeado)', async () => {
    const locks = createRowLockManager();

    // A->B: bloquea A (emisor) luego B (receptor).
    const txAB = oldOrderTransfer(locks, 'user-A', 'user-B');
    // B->A: bloquea B (emisor) luego A (receptor) — orden INVERTIDO respecto a txAB.
    const txBA = oldOrderTransfer(locks, 'user-B', 'user-A');

    // Clásico deadlock: txAB tiene A y espera B; txBA tiene B y espera A. Ninguna de
    // las dos puede completar nunca — se verifica con un timeout real y corto (no
    // fake timers: acá se está probando una espera real entre promesas).
    const { timedOut } = await withTimeout(Promise.all([txAB, txBA]), 250);
    expect(timedOut).toBe(true);
  });

  it('orden NUEVO (por user_id): A->B y B->A simultáneos completan los dos siempre, sin deadlock', async () => {
    const locks = createRowLockManager();

    const txAB = newOrderTransfer(locks, 'user-A', 'user-B');
    const txBA = newOrderTransfer(locks, 'user-B', 'user-A');

    const { timedOut, result } = await withTimeout(Promise.all([txAB, txBA]), 250);
    expect(timedOut).toBe(false);

    // Las dos "transacciones" consiguieron sus locks, hicieron su trabajo y
    // liberaron todo solas — nadie quedó esperando para siempre.
    expect(result).toEqual([true, true]);
  });

  it('orden NUEVO: /give cruzado con /rob sobre las mismas dos cuentas tampoco deadlockea', async () => {
    const locks = createRowLockManager();

    // /give A->B usa transfer_balance(A,B); /rob con robber=B, víctima=A usa
    // rob_wallet(B,A) — mismo par de filas, roles invertidos.
    const give = newOrderTransfer(locks, 'user-A', 'user-B');
    const rob = newOrderTransfer(locks, 'user-B', 'user-A');

    const { timedOut, result } = await withTimeout(Promise.all([give, rob]), 250);
    expect(timedOut).toBe(false);
    expect(result).toEqual([true, true]);
  });

  it('orden NUEVO: 4 operaciones concurrentes entre 3 cuentas (A-B, B-C, C-A, A-B de nuevo) todas completan', async () => {
    // Caso más realista que un solo par: varias transferencias simultáneas
    // entrecruzadas entre más de dos cuentas, mismo criterio de orden aplicado a
    // cada par por separado.
    const locks = createRowLockManager();
    const ops = [
      newOrderTransfer(locks, 'user-A', 'user-B'),
      newOrderTransfer(locks, 'user-B', 'user-C'),
      newOrderTransfer(locks, 'user-C', 'user-A'),
      newOrderTransfer(locks, 'user-B', 'user-A'),
    ];

    const { timedOut, result } = await withTimeout(Promise.all(ops), 500);
    expect(timedOut).toBe(false);
    expect(result).toEqual([true, true, true, true]);
  });
});

describe('Estado final consistente bajo el orden NUEVO (integridad de balances)', () => {
  // Simulación de balances real (no solo locks): cada "transacción" hace
  // lectura->validación->escritura DENTRO de la sección crítica que el lock ordenado
  // protege — mismo invariante que transfer_balance/rob_wallet en SQL: el balance
  // total del sistema nunca cambia, y nunca queda negativo.
  function createLedger(initial) {
    return new Map(Object.entries(initial));
  }

  async function transferWithLock(locks, ledger, senderId, receiverId, amount) {
    const [first, second] = senderId < receiverId ? [senderId, receiverId] : [receiverId, senderId];
    const releaseFirst = await locks.acquire(first);
    const releaseSecond = await locks.acquire(second);
    try {
      // Punto de contención real: un `await` DENTRO de la sección crítica, para que
      // dos transferencias concurrentes de verdad se entrelacen si el locking
      // fallara — no una simple resta síncrona que nunca expondría una carrera.
      await Promise.resolve();
      const senderBalance = ledger.get(senderId);
      if (senderBalance < amount) return { ok: false };
      ledger.set(senderId, senderBalance - amount);
      await Promise.resolve();
      ledger.set(receiverId, ledger.get(receiverId) + amount);
      return { ok: true };
    } finally {
      releaseSecond();
      releaseFirst();
    }
  }

  it('10 transferencias cruzadas concurrentes entre A y B: sin deadlock, suma total preservada, nunca balances negativos', async () => {
    const locks = createRowLockManager();
    const ledger = createLedger({ 'user-A': 1000, 'user-B': 1000 });
    const TOTAL = 2000;

    const ops = [];
    for (let i = 0; i < 5; i++) {
      ops.push(transferWithLock(locks, ledger, 'user-A', 'user-B', 100));
      ops.push(transferWithLock(locks, ledger, 'user-B', 'user-A', 50));
    }

    const { timedOut } = await withTimeout(Promise.all(ops), 1000);
    expect(timedOut).toBe(false);

    expect(ledger.get('user-A') + ledger.get('user-B')).toBe(TOTAL);
    expect(ledger.get('user-A')).toBeGreaterThanOrEqual(0);
    expect(ledger.get('user-B')).toBeGreaterThanOrEqual(0);
  });
});
