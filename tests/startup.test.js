import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Fase 3B (eliminación de Pets, 2026-09-01) — verificación explícita de que borrar
// pet.js/petsStore.js/petCardImage.js no deja ningún import roto en el resto del bot.
// Reproduce EXACTAMENTE el mismo descubrimiento dinámico que usan src/index.js
// (loadCommands/loadEvents) y src/deploy-commands.js (loadCommandData) — fs.readdirSync
// sobre las carpetas reales + import() real de cada archivo, sin mockear nada. Si algo
// quedó con un import a un archivo borrado, esto revienta con el mismo error real que
// tiraría el bot al arrancar ("Cannot find module ..."), no una simulación.
const rootDir = path.resolve(fileURLToPath(import.meta.url), '..', '..');

async function loadAllCommands() {
  const commandsPath = path.join(rootDir, 'src', 'commands');
  const commands = [];
  const seenNames = new Map();

  const categories = fs.readdirSync(commandsPath, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const category of categories) {
    const categoryPath = path.join(commandsPath, category.name);
    const files = fs.readdirSync(categoryPath).filter((f) => f.endsWith('.js'));
    for (const file of files) {
      const filePath = path.join(categoryPath, file);
      const command = await import(pathToFileURL(filePath).href);
      if (!('data' in command) || !('execute' in command)) {
        throw new Error(`${filePath} le falta "data" o "execute"`);
      }
      const json = command.data.toJSON();
      const previous = seenNames.get(json.name);
      if (previous) throw new Error(`Nombre de comando duplicado "${json.name}": ${previous} y ${filePath}`);
      seenNames.set(json.name, filePath);
      commands.push({ name: json.name, filePath });
    }
  }
  return commands;
}

async function loadAllEvents() {
  const eventsPath = path.join(rootDir, 'src', 'events');
  const files = fs.readdirSync(eventsPath).filter((f) => f.endsWith('.js'));
  const events = [];
  for (const file of files) {
    const filePath = path.join(eventsPath, file);
    const event = await import(pathToFileURL(filePath).href);
    events.push({ name: event.name, filePath });
  }
  return events;
}

// import() real de ~74 comandos + ~32 eventos es más pesado que un test unitario típico
// — bajo la suite completa (67 archivos corriendo juntos, muchos con su propio import()
// real) puede superar el timeout default de vitest (5s), sin que sea una regresión real.
// Se carga UNA sola vez acá (con timeout propio, más generoso) en vez de en cada `it`,
// que además evita reimportar los mismos ~106 archivos 3 veces.
let commands;
let eventsError;

beforeAll(async () => {
  commands = await loadAllCommands();
  eventsError = await loadAllEvents()
    .then(() => null)
    .catch((error) => error);
}, 30_000);

describe('startup — descubrimiento dinámico de comandos/eventos, sin Pets', () => {
  it('todos los archivos de src/commands/** importaron sin error (ningún "Cannot find module")', () => {
    expect(commands).toBeInstanceOf(Array);
    expect(commands.length).toBeGreaterThan(0);
  });

  it('/pet ya no está en la lista de comandos descubiertos', () => {
    expect(commands.find((c) => c.name === 'pet')).toBeUndefined();
  });

  it('no quedan nombres de comando duplicados (mismo chequeo que deploy-commands.js)', () => {
    const names = commands.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('todos los archivos de src/events/** importan sin error, incluido guildDelete.js y voiceStateUpdate.js', () => {
    expect(eventsError).toBeNull();
  });
});
