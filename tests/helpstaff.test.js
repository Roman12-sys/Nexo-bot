import { describe, it, expect } from 'vitest';
import {
  buildAdministracionEmbed,
  buildModeracionEmbed,
  buildAdvertenciasEmbed,
  buildSorteosAnunciosEmbed,
  buildEconomiaEmbed,
  buildRolesEmbed,
  buildXpEmbed,
  buildBotEmbed,
} from '../src/commands/informacion/helpstaff.js';

// Auditoría Ciclo 1, Bloque 7 (hallazgo Bajo) — /config rol-autoasignable-agregar/quitar
// no aparecía en ningún lugar de /helpstaff (a diferencia de /report, que sí tenía su
// propio campo dedicado desde Fase 4C-1) — un admin que no sabía que la función existía
// no tenía ningún camino de descubrimiento dentro de Discord.
describe('/helpstaff — Administración: roles autoasignables (Bloque 7)', () => {
  it('tiene un campo dedicado mencionando ambos subcommands', () => {
    const embed = buildAdministracionEmbed();
    const field = embed.data.fields.find((f) => f.name.includes('Roles autoasignables'));

    expect(field).toBeDefined();
    expect(field.name).toContain('rol-autoasignable-agregar');
    expect(field.name).toContain('rol-autoasignable-quitar');
  });

  it('el resto de los campos de Administración (setup, config ver, rol-admin) siguen intactos', () => {
    const embed = buildAdministracionEmbed();
    const names = embed.data.fields.map((f) => f.name);

    expect(names.some((n) => n === '/setup')).toBe(true);
    expect(names.some((n) => n === '/config ver')).toBe(true);
    expect(names.some((n) => n === '/config rol-admin')).toBe(true);
  });
});

// El bloque solo debía tocar Administración — el resto de las categorías de /helpstaff
// tiene que seguir exactamente como estaba.
describe('/helpstaff — otras categorías intactas', () => {
  it('Moderación sigue con sus comandos de siempre', () => {
    const names = buildModeracionEmbed().data.fields.map((f) => f.name);
    expect(names).toEqual(
      expect.arrayContaining(['/clear <cantidad>', '/lock', '/unlock', '/kick <usuario>', '/ban <usuario>', '/timeout <usuario> <duración>']),
    );
  });

  it('Advertencias y sanciones sigue con sus comandos de siempre', () => {
    const names = buildAdvertenciasEmbed().data.fields.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(['/warn <usuario> <motivo>', '/sanciones']));
  });

  it('Sorteos y anuncios, Economía, Roles, XP y Bot siguen sin cambios de estructura', () => {
    expect(buildSorteosAnunciosEmbed().data.fields.length).toBeGreaterThan(0);
    expect(buildEconomiaEmbed().data.fields.length).toBeGreaterThan(0);
    expect(buildRolesEmbed().data.fields.length).toBeGreaterThan(0);
    expect(buildXpEmbed().data.fields.length).toBeGreaterThan(0);
    expect(buildBotEmbed().data.fields.length).toBeGreaterThan(0);
  });
});
