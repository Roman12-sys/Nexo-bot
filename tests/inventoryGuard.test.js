import { vi, describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSupabaseMock } from './helpers/supabaseMock.js';

// FASE 1 (auditoría de seguridad/economía, 2026-08-30) — increment_inventory_item (RPC
// de Postgres, ver schema.sql) no tenía ningún piso: dos consumos concurrentes del mismo
// ítem (ej. /vender y /pet alimentar sobre el mismo item_id — usan locks de JS con keys
// distintas, "vender:" vs "pet:", que nunca se excluyen entre sí) podían dejar la
// cantidad en negativo. El fix agrega "select ... for update" + guard en la propia
// función de Postgres.
//
// LÍMITE HONESTO DE ESTE ARCHIVO: la atomicidad real (que "for update" efectivamente
// serialice dos transacciones concurrentes) es responsabilidad de Postgres y NO se puede
// probar sin una instancia real (mismo criterio que ya documenta economyStore.test.js
// para increment_balance/transfer_balance). Lo que este archivo prueba con certeza:
// (1) que el guard sigue presente en el texto de la función en schema.sql (si alguien lo
// edita y lo borra sin querer, esto lo detecta), y (2) que el WRAPPER de JS
// (incrementInventoryItem) llama a la RPC, mapea su error a .code correctamente, y que
// la lógica que la función de Postgres implementa (reproducida acá 1:1 a partir de su
// propio texto) preserva el invariante "nunca negativo" bajo dos llamadas que compiten
// por la última unidad — a diferencia de la lógica VIEJA (sin guard), que si se
// reproduce de la misma forma, sí produce -1 (ver el primer test, que ancla el bug).
// Verificación de que la migración realmente corrió contra Supabase de producción queda
// pendiente del usuario (no verificable desde este entorno).

const schemaPath = fileURLToPath(new URL('../schema.sql', import.meta.url));
const schemaSql = readFileSync(schemaPath, 'utf-8');

function extractFunctionBody(fnName) {
  const match = schemaSql.match(new RegExp(`create or replace function ${fnName}\\([\\s\\S]*?\\$\\$;`, 'i'));
  if (!match) throw new Error(`No se encontró la función "${fnName}" en schema.sql`);
  return match[0];
}

describe('schema.sql — increment_inventory_item declara el guard atómico', () => {
  const body = extractFunctionBody('increment_inventory_item');

  it('bloquea la fila antes de leer la cantidad (for update)', () => {
    expect(body.toLowerCase()).toMatch(/for update/);
  });

  it('rechaza con un error identificable si el resultado quedaría negativo', () => {
    expect(body).toMatch(/v_new_qty\s*<\s*0/);
    expect(body).toMatch(/raise exception 'insufficient_inventory'/);
  });
});

// --- Mirror del algoritmo, para probar el INVARIANTE bajo dos llamadas concurrentes ---

const state = new Map(); // `${guildId}:${userId}` -> { [itemId]: qty }
const stateKey = (g, u) => `${g}:${u}`;

function oldUnguardedRpc(params) {
  // Reproduce la función VIEJA (antes del fix): sin lock, sin guard — jsonb_set con
  // coalesce(...) + p_qty sin ningún chequeo. Sirve para anclar el bug: probar que ESTA
  // lógica sí produce -1 bajo el mismo escenario que el fix evita.
  const k = stateKey(params.p_guild_id, params.p_user_id);
  const inventory = state.get(k) || {};
  const next = (inventory[params.p_item_id] || 0) + params.p_qty;
  inventory[params.p_item_id] = next;
  state.set(k, inventory);
  return { data: { ...inventory }, error: null };
}

function newGuardedRpc(params) {
  // Reproduce 1:1 la función NUEVA de schema.sql: lee (simulando el lock de "for
  // update" — nada más puede haber tocado la fila entre llamadas porque cada llamada al
  // mock corre sincrónicamente de punta a punta, igual que Postgres serializa dos
  // transacciones sobre la misma fila bloqueada), calcula, y rechaza si da negativo.
  const k = stateKey(params.p_guild_id, params.p_user_id);
  const inventory = state.get(k) || {};
  const current = inventory[params.p_item_id] || 0;
  const nextQty = current + params.p_qty;
  if (nextQty < 0) {
    return { data: null, error: { message: 'insufficient_inventory' } };
  }
  inventory[params.p_item_id] = nextQty;
  state.set(k, inventory);
  return { data: { ...inventory }, error: null };
}

describe('increment_inventory_item — invariante bajo dos consumos concurrentes del último ítem', () => {
  beforeEach(() => {
    state.clear();
  });

  it('ancla el bug: la lógica VIEJA (sin guard) sí deja la cantidad en -1', () => {
    state.set(stateKey('guild-1', 'user-1'), { pocion: 1 });
    const params = { p_guild_id: 'guild-1', p_user_id: 'user-1', p_item_id: 'pocion', p_qty: -1 };

    oldUnguardedRpc(params);
    oldUnguardedRpc(params);

    expect(state.get(stateKey('guild-1', 'user-1')).pocion).toBe(-1);
  });

  it('con el guard nuevo: solo una de las dos llamadas completa, la otra es rechazada, nunca queda en -1', () => {
    state.set(stateKey('guild-1', 'user-1'), { pocion: 1 });
    const params = { p_guild_id: 'guild-1', p_user_id: 'user-1', p_item_id: 'pocion', p_qty: -1 };

    const resultA = newGuardedRpc(params);
    const resultB = newGuardedRpc(params);

    const results = [resultA, resultB];
    const succeeded = results.filter((r) => r.error === null);
    const rejected = results.filter((r) => r.error?.message === 'insufficient_inventory');

    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(state.get(stateKey('guild-1', 'user-1')).pocion).toBe(0); // nunca -1
  });
});

// --- El wrapper real de JS (economyStore.incrementInventoryItem) sobre el mock guardado ---

const supabaseMock = createSupabaseMock();
vi.mock('../src/supabaseClient.js', () => ({ get supabase() { return supabaseMock; } }));

const { incrementInventoryItem } = await import('../src/utils/economyStore.js');

beforeEach(() => {
  vi.clearAllMocks();
  state.clear();
  supabaseMock.rpc.mockReset();
  supabaseMock.rpc.mockImplementation(async (fnName, params) => {
    if (fnName !== 'increment_inventory_item') throw new Error(`RPC no simulada en este test: ${fnName}`);
    return newGuardedRpc(params);
  });
});

describe('incrementInventoryItem (wrapper JS) — mapeo de resultado/error', () => {
  it('operación legítima (compra, delta positivo) funciona normal', async () => {
    const inventory = await incrementInventoryItem('guild-1', 'user-1', 'pocion', 1);
    expect(inventory).toEqual({ pocion: 1 });
  });

  it('operación legítima (consumo con stock suficiente) funciona normal', async () => {
    state.set(stateKey('guild-1', 'user-1'), { pocion: 3 });
    const inventory = await incrementInventoryItem('guild-1', 'user-1', 'pocion', -1);
    expect(inventory).toEqual({ pocion: 2 });
  });

  it('dos consumos concurrentes del último ítem (Promise.all): uno resuelve, el otro rechaza con .code identificable', async () => {
    state.set(stateKey('guild-1', 'user-1'), { pocion: 1 });
    const params = ['guild-1', 'user-1', 'pocion', -1];

    const results = await Promise.allSettled([incrementInventoryItem(...params), incrementInventoryItem(...params)]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason.code).toBe('insufficient_inventory');
    expect(fulfilled[0].value.pocion).toBe(0); // nunca -1
  });
});
