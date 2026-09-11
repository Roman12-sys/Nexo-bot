import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { COMMANDS, getCommandsByCategory, sampleExamplesForCategory, formatPermissionLabel } from '../website/data/commands.js';
import { FEATURES, TOTAL_COMMANDS_IN_FEATURES } from '../website/data/features.js';
import { CATEGORY_META } from '../website/data/categories.js';
import { stats } from '../website/data/stats.js';

const REPO_ROOT = path.join(import.meta.dirname, '..');

describe('website/data/commands.js', () => {
  it('el JSON generado tiene comandos (si esto falla, correr npm run website:generate-commands)', () => {
    expect(COMMANDS.length).toBeGreaterThan(0);
  });

  it('getCommandsByCategory solo devuelve comandos de esa categoría', () => {
    const economia = getCommandsByCategory('economia');
    expect(economia.length).toBeGreaterThan(0);
    expect(economia.every((c) => c.category === 'economia')).toBe(true);
  });

  it('getCommandsByCategory de una categoría inexistente da lista vacía, no undefined/throw', () => {
    expect(getCommandsByCategory('no-existe')).toEqual([]);
  });

  it('sampleExamplesForCategory nunca excede el límite pedido', () => {
    const examples = sampleExamplesForCategory('moderacion', 4);
    expect(examples.length).toBeLessThanOrEqual(4);
  });

  it('sampleExamplesForCategory reparte entre comandos (maxPerCommand) en vez de agotar el cupo en el primero', () => {
    // /config tiene muchos más de 2 subcomandos reales — si no respetara maxPerCommand,
    // las primeras 6 muestras de "administracion" serían todas "/config ...".
    const examples = sampleExamplesForCategory('administracion', 6, 2);
    const configOnly = examples.every((e) => e.startsWith('/config'));
    expect(configOnly).toBe(false);
  });

  it('sampleExamplesForCategory nunca inventa un subcomando que no esté en options', () => {
    const sorteoCommand = COMMANDS.find((c) => c.name === 'sorteo');
    const realSubcommandNames = sorteoCommand.options.filter((o) => o.kind === 'subcommand').map((o) => o.name);

    for (const example of sampleExamplesForCategory('sorteos', 10)) {
      const [, sub] = example.split(' ');
      if (sub) expect(realSubcommandNames).toContain(sub);
    }
  });

  it('el split economía/casino de scripts/generate-commands-data.js separó bien los 4 juegos reales', () => {
    const casino = getCommandsByCategory('casino').map((c) => c.name).sort();
    expect(casino).toEqual(['coinflip', 'dado', 'ruleta', 'slots']);

    const economia = getCommandsByCategory('economia').map((c) => c.name);
    expect(economia).not.toContain('coinflip');
    expect(economia).not.toContain('slots');
  });

  it('formatPermissionLabel traduce los permisos conocidos y no rompe con uno desconocido', () => {
    expect(formatPermissionLabel('BanMembers')).toBe('Banear miembros');
    expect(formatPermissionLabel('AlgoQueNoExiste')).toBe('AlgoQueNoExiste');
  });
});

describe('website/data/features.js', () => {
  it('la suma de commandCount de todas las features coincide con el total de comandos reales', () => {
    expect(TOTAL_COMMANDS_IN_FEATURES).toBe(COMMANDS.length);
  });

  it('cada feature (salvo voz) tiene al menos 1 sampleCommand real, nunca vacío', () => {
    for (const feature of FEATURES) {
      expect(feature.sampleCommands.length).toBeGreaterThan(0);
    }
  });

  it('"voz" no tiene comandos reales y usa el manualNote, no una derivación inventada', () => {
    const voz = FEATURES.find((f) => f.id === 'voz');
    expect(voz.commandCount).toBe(0);
    expect(voz.sampleCommands[0]).toBe(voz.manualNote);
  });

  it('todo feature.id tiene una entrada correspondiente en CATEGORY_META (una sola fuente de emoji/nombre)', () => {
    for (const feature of FEATURES) {
      expect(CATEGORY_META[feature.id], `falta CATEGORY_META.${feature.id}`).toBeDefined();
    }
  });
});

describe('website/data/stats.js — coherencia contra el filesystem real', () => {
  it('stats.commands coincide con la cantidad real de archivos .js en src/commands/', () => {
    let count = 0;
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) count += 1;
      }
    };
    walk(path.join(REPO_ROOT, 'src', 'commands'));

    expect(stats.commands).toBe(count);
  });

  it('stats.categories coincide con la cantidad real de subcarpetas de src/commands/', () => {
    const categories = fs.readdirSync(path.join(REPO_ROOT, 'src', 'commands'), { withFileTypes: true }).filter((d) => d.isDirectory());
    expect(stats.categories).toBe(categories.length);
  });

  it('stats.tests es mayor que 0 y coincide con lo que hay en tests/ ahora mismo', () => {
    let count = 0;
    for (const entry of fs.readdirSync(path.join(REPO_ROOT, 'tests'))) {
      if (!entry.endsWith('.test.js')) continue;
      const content = fs.readFileSync(path.join(REPO_ROOT, 'tests', entry), 'utf8');
      const matches = content.match(/^\s*(it|test)\(/gm);
      count += matches ? matches.length : 0;
    }
    expect(stats.tests).toBe(count);
  });
});
