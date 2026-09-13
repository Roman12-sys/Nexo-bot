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
  },
});
