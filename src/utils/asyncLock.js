// Serializa llamadas async para la misma key: si ya hay una ejecución en curso
// para esa key, la siguiente espera a que termine antes de arrancar. Cierra el
// race de "leer cooldown, decidir, recién después escribir" en comandos como
// /daily, /work, /trivia (invocaciones casi simultáneas del mismo
// usuario ya no pueden leer el mismo estado viejo antes de que la primera lo actualice).
const locks = new Map();

export function withLock(key, fn) {
  const previous = locks.get(key) || Promise.resolve();
  const run = previous.then(fn, fn);
  const tail = run.then(
    () => {},
    () => {},
  );
  locks.set(key, tail);
  tail.finally(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return run;
}
