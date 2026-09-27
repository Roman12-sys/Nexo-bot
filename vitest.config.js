import { defineConfig, configDefaults } from 'vitest/config';

// Sin este archivo, vitest no tenía ningún exclude propio — escaneaba TODO el árbol
// de directorios buscando *.test.js, incluidos los worktrees de git abandonados bajo
// .claude/worktrees/ (dejados por sesiones de agentes anteriores). Esos worktrees
// tienen su propia copia completa de tests/, así que cada `npm test` sumaba cientos de
// archivos duplicados/desactualizados a la corrida — inflando el conteo real y, el
// 2026-09-12, produciendo 4 fallos falsos de un test viejo (voiceXpEngine.test.js) que
// no existen en el código real del proyecto.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '.claude/**'],
    // Corta cualquier conexión real a Supabase desde la suite — ver el archivo.
    setupFiles: ['./tests/setup/noLiveSupabase.js'],
    // 2026-09-27: con la máquina ocupada, 1 de 5 corridas falló 5 tests y salteó 12 —
    // todos en el primer `await import()` de un archivo (cargar discord.js y el resto
    // puede tardar más de los 5s por defecto), nunca por un error de lógica. 15s deja
    // margen para eso sin esconder un test colgado de verdad.
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
