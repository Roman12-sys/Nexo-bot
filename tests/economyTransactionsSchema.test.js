import { vi, describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSupabaseMock } from './helpers/supabaseMock.js';

// FASE 1 (auditoría de seguridad/economía, 2026-08-30) — economy_transactions.delivered
// se usaba en 3 lugares del código (getGuildPurchasesByReason, markPurchaseDelivered,
// /economia-staff pendientes) pero nunca se declaró en schema.sql: drift real entre lo
// que el código pide/escribe y lo que la tabla declara.
//
// Este archivo NO hardcodea "delivered" como el único chequeo — PARSEA las columnas
// declaradas de economy_transactions en schema.sql y las compara contra las columnas que
// economyStore.js REALMENTE pide/escribe (capturadas de los argumentos reales que le
// llegan a .select()/.insert()/.update() vía el mock de Supabase). Si mañana alguien
// agrega una columna nueva a cualquiera de estas queries sin declararla en schema.sql,
// este archivo falla señalando el nombre exacto de la columna faltante — no solo repite
// "delivered".
const schemaPath = fileURLToPath(new URL('../schema.sql', import.meta.url));
const schemaSql = readFileSync(schemaPath, 'utf-8');

function parseTableColumns(tableName) {
  const match = schemaSql.match(new RegExp(`create table if not exists ${tableName} \\(([\\s\\S]*?)\\n\\);`, 'i'));
  if (!match) throw new Error(`schema.sql no declara la tabla "${tableName}"`);
  const reserved = new Set(['primary', 'unique', 'foreign', 'check', 'constraint']);
  return match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('--'))
    .map((line) => line.split(/\s+/)[0].replace(/,$/, ''))
    .filter((word) => word && !reserved.has(word.toLowerCase()));
}

const supabaseMock = createSupabaseMock();
vi.mock('../src/supabaseClient.js', () => ({ get supabase() { return supabaseMock; } }));

const { getGuildPurchasesByReason, markPurchaseDelivered, recordTransaction, getUserTransactions } = await import('../src/utils/economyStore.js');

beforeEach(() => {
  vi.clearAllMocks();
  supabaseMock.rpc.mockReset();
  supabaseMock.getBuilder('economy_transactions').__setResult({ data: null, error: null });
});

describe('schema drift: economy_transactions', () => {
  const declaredColumns = parseTableColumns('economy_transactions');

  it('sanity: el parser realmente extrajo columnas de schema.sql (si esto falla, el resto del archivo no prueba nada)', () => {
    expect(declaredColumns).toEqual(expect.arrayContaining(['guild_id', 'user_id', 'type', 'amount', 'balance_after']));
  });

  it('declara "delivered" — sin esto, getGuildPurchasesByReason/markPurchaseDelivered fallan en producción con "column does not exist"', () => {
    expect(declaredColumns).toContain('delivered');
  });

  it('getGuildPurchasesByReason: todas las columnas pedidas en .select() están declaradas', async () => {
    await getGuildPurchasesByReason('guild-1', ['reason-1'], 25, { onlyPending: true });
    const builder = supabaseMock.getBuilder('economy_transactions');
    const selected = builder.select.mock.calls[0][0].split(',').map((c) => c.trim());

    for (const column of selected) {
      expect(declaredColumns, `columna "${column}" pedida por getGuildPurchasesByReason no está declarada en schema.sql`).toContain(column);
    }
    // onlyPending filtra además por la misma columna vía .eq() — confirma que el filtro
    // usa el nombre real, no uno que haya divergido del select de arriba.
    expect(builder.eq).toHaveBeenCalledWith('delivered', false);
  });

  it('markPurchaseDelivered: la columna que actualiza está declarada', async () => {
    await markPurchaseDelivered(123);
    const builder = supabaseMock.getBuilder('economy_transactions');
    const updatedColumns = Object.keys(builder.update.mock.calls[0][0]);

    for (const column of updatedColumns) {
      expect(declaredColumns, `columna "${column}" escrita por markPurchaseDelivered no está declarada en schema.sql`).toContain(column);
    }
  });

  it('recordTransaction: todas las columnas insertadas están declaradas', async () => {
    await recordTransaction('guild-1', 'user-1', { type: 'purchase', amount: -100, balanceAfter: 0, reason: 'ítem x' });
    const builder = supabaseMock.getBuilder('economy_transactions');
    const insertedColumns = Object.keys(builder.insert.mock.calls[0][0]);

    for (const column of insertedColumns) {
      expect(declaredColumns, `columna "${column}" insertada por recordTransaction no está declarada en schema.sql`).toContain(column);
    }
  });

  it('getUserTransactions: todas las columnas pedidas en .select() están declaradas', async () => {
    await getUserTransactions('guild-1', 'user-1');
    const builder = supabaseMock.getBuilder('economy_transactions');
    const selected = builder.select.mock.calls[0][0].split(',').map((c) => c.trim());

    for (const column of selected) {
      expect(declaredColumns, `columna "${column}" pedida por getUserTransactions no está declarada en schema.sql`).toContain(column);
    }
  });
});
