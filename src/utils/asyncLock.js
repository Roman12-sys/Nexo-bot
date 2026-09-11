// Serializa llamadas async para la misma key: si ya hay una ejecución en curso
// para esa key, la siguiente espera a que termine antes de arrancar. Cierra el
// race de "leer cooldown, decidir, recién después escribir" en comandos como
// /daily, /work, /trivia (invocaciones casi simultáneas del mismo
// usuario ya no pueden leer el mismo estado viejo antes de que la primera lo actualice).
//
// Timeout (auditoría adversarial round 2, Bloque 2): sin esto, una `fn` que nunca
// resuelve (stall de red real hacia Supabase, un bug futuro que deja un await
// colgado) dejaba esa key bloqueada PARA SIEMPRE — cualquier operación futura sobre
// el mismo `${comando}:${guild}:${user}` quedaba encolada sin ningún error visible,
// solo el timeout de 3s de Discord cortando la interacción sin explicación. Al
// vencer el timeout: la key se libera para el siguiente caller (la cola sigue
// andando) y se reporta como error crítico — la llamada original que colgó NO se
// cancela de verdad (JS no puede abortar una promesa en curso), pero deja de
// bloquear a nadie más. Trade-off aceptado a propósito: para las primitivas de
// dinero, la garantía real de no-corrupción la dan las RPCs de Postgres con
// `for update` (ver schema.sql) — el lock de JS es una optimización de UX
// (fail-fast con mensajes claros de cooldown), no la última línea de defensa.
import { reportCriticalError } from './errorReporter.js';

const locks = new Map();

export const DEFAULT_LOCK_TIMEOUT_MS = 20_000;

export class LockTimeoutError extends Error {
  constructor(key, timeoutMs) {
    super(`withLock: timeout de ${timeoutMs}ms esperando la operación para la key "${key}"`);
    this.name = 'LockTimeoutError';
    this.key = key;
    this.timeoutMs = timeoutMs;
  }
}

// `fn` puede recibir opcionalmente { timeoutMs } como tercer parámetro para
// override puntual (ej. tests, o una operación legítimamente más lenta que el
// default) — 0 o null desactiva el timeout para esa llamada.
export function withLock(key, fn, { timeoutMs = DEFAULT_LOCK_TIMEOUT_MS } = {}) {
  const previous = locks.get(key) || Promise.resolve();

  // `run` es el resultado real de la operación — lo que el caller original recibe
  // si nunca se dispara el timeout. Se calcula sobre `previous` tal cual siempre
  // (nunca sobre el timeout), así que el ENCADENAMIENTO de operaciones legítimas
  // sigue siendo estrictamente secuencial incluso si una operación anterior venció
  // por timeout y ya liberó la key para la cola.
  const run = previous.then(fn, fn);

  let timer = null;
  const raced = timeoutMs > 0
    ? Promise.race([
        run,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new LockTimeoutError(key, timeoutMs)), timeoutMs);
        }),
      ])
    : run;

  // `tail` es lo que se guarda en el Map para encolar al siguiente caller — se
  // resuelve apenas CUALQUIERA de las dos (la operación real o el timeout) termine
  // primero, así el próximo `withLock(key, ...)` nunca queda esperando más que
  // `timeoutMs`, sin importar si la operación anterior sigue corriendo en segundo
  // plano.
  const tail = raced.then(
    () => {},
    () => {},
  );
  locks.set(key, tail);
  tail.finally(() => {
    if (locks.get(key) === tail) locks.delete(key);
    if (timer) clearTimeout(timer);
  });

  // Si el timeout fue lo que ganó la carrera, la operación real (`run`) sigue viva
  // — no hay forma de cancelarla — así que se le engancha un log tardío para no
  // perder rastro de un éxito/fallo que llegó después de que ya se reportó como
  // colgado, y se alerta una sola vez vía el mecanismo de error crítico existente.
  raced.catch((error) => {
    if (!(error instanceof LockTimeoutError)) return;
    reportCriticalError(null, `asyncLock:timeout:${key}`, error).catch(() => {});
    run.then(
      () => console.error(`⚠️ asyncLock: la operación para "${key}" completó DESPUÉS del timeout de ${timeoutMs}ms.`),
      (lateError) => console.error(`⚠️ asyncLock: la operación para "${key}" falló DESPUÉS del timeout de ${timeoutMs}ms:`, lateError),
    );
  });

  return raced;
}
