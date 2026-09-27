// Números reales del repo, calculados al arrancar (no hardcodeados) — leyendo el mismo
// filesystem que usa src/deploy-commands.js para descubrir comandos, pero SIN importar
// ninguno de esos archivos (evita arrastrar utils/economyStore.js -> supabaseClient.js
// -> exigir SUPABASE_*/DISCORD_TOKEN en este proceso, ver el comentario de config.js).
// Cuenta archivos/carpetas, nunca ejecuta código del bot.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

// Comandos públicos: sin los que son solo del operador (`export const ownerGuildOnly =
// true`, hoy /owner-metricas), que Discord registra únicamente en el servidor de
// pruebas — así el número coincide con los comandos que ve cualquier servidor y con
// /commands (2026-09-27). Se detecta leyendo el texto, sin importar el archivo.
const OWNER_ONLY_EXPORT = /export\s+const\s+ownerGuildOnly\s*=\s*true/;

function countPublicCommandFiles(dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) count += countPublicCommandFiles(full);
    else if (entry.name.endsWith('.js') && !OWNER_ONLY_EXPORT.test(fs.readFileSync(full, 'utf8'))) count += 1;
  }
  return count;
}

function countTestCases(dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countTestCases(full);
    } else if (entry.name.endsWith('.test.js')) {
      const content = fs.readFileSync(full, 'utf8');
      const matches = content.match(/^\s*(it|test)\(/gm);
      count += matches ? matches.length : 0;
    }
  }
  return count;
}

function computeStats() {
  const commandsDir = path.join(REPO_ROOT, 'src', 'commands');
  const eventsDir = path.join(REPO_ROOT, 'src', 'events');
  const testsDir = path.join(REPO_ROOT, 'tests');

  const categories = fs.readdirSync(commandsDir, { withFileTypes: true }).filter((d) => d.isDirectory());

  return {
    commands: countPublicCommandFiles(commandsDir),
    categories: categories.length,
    events: fs.readdirSync(eventsDir).filter((f) => f.endsWith('.js')).length,
    tests: fs.existsSync(testsDir) ? countTestCases(testsDir) : 0,
    // "Sistemas" no es una cuenta mecánica de archivos (una feature real puede repartirse
    // en varios utils + comandos + un listener) — es una lista curada a mano, verificada
    // contra CLAUDE.md y el código real, no un número redondo inventado. Se deja como
    // array (no solo el largo) para que quede trazable qué se está contando.
    systems: [
      'Moderación', 'Economía', 'Casino', 'XP y niveles', 'Prestigio', 'Misiones',
      'Logros', 'Sorteos', 'Trivia', 'Voz temporal (Join to Create)', 'Anuncios',
      'Roles autoasignables', 'Digest semanal',
    ],
  };
}

export const stats = computeStats();
