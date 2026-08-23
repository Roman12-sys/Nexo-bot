// Infra de testing compartida: un mock de supabase-js reusable por cualquier test que
// necesite mockear src/supabaseClient.js. Antes de esto cada test que necesitaba
// supabase.from(...) mockeaba `{}` y solo podía testear funciones puras — esto permite
// testear también el camino que sí toca la red, sin pegarle a un Supabase real (nunca
// se ejecutan queries contra la base de datos de producción desde los tests).
//
// El builder que devuelve from(tabla) es a la vez encadenable (select().eq().eq(), como
// getUserEconomy) Y "thenable" (awaitable directo sin terminal, como setCooldown:
// .update(...).eq().eq()) — así cubre los dos estilos de query que usa el proyecto sin
// tener que replicar el driver real de supabase-js.
import { vi } from 'vitest';

const CHAIN_METHODS = ['select', 'eq', 'order', 'limit', 'upsert', 'update', 'insert', 'delete', 'in'];

export function createQueryBuilder(initialResult = { data: null, error: null }) {
  let result = initialResult;
  const builder = {};

  for (const method of CHAIN_METHODS) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.then = (onResolve, onReject) => Promise.resolve(result).then(onResolve, onReject);

  builder.__setResult = (next) => {
    result = next;
  };

  return builder;
}

export function createSupabaseMock() {
  const rpc = vi.fn();
  const builders = new Map();

  function getBuilder(table) {
    if (!builders.has(table)) builders.set(table, createQueryBuilder());
    return builders.get(table);
  }

  const from = vi.fn((table) => getBuilder(table));

  return { rpc, from, getBuilder };
}
