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
//
// Auditoría UX/UI (2026-09-18), formato de comandos: Administración pasó de un campo por
// comando a 3 campos agrupados por tema — las aserciones ahora buscan el comando dentro
// del VALUE del grupo correspondiente, no como field.name exacto.
describe('/helpstaff — Administración: roles autoasignables (Bloque 7)', () => {
  it('el grupo de roles y permisos menciona ambos subcommands', () => {
    const embed = buildAdministracionEmbed();
    const field = embed.data.fields.find((f) => f.value.includes('rol-autoasignable-agregar'));

    expect(field).toBeDefined();
    expect(field.value).toContain('rol-autoasignable-quitar');
  });

  it('el resto de los comandos de Administración (setup, config ver, rol-admin) siguen intactos', () => {
    const embed = buildAdministracionEmbed();
    const allValues = embed.data.fields.map((f) => f.value).join('\n');

    expect(allValues).toContain('/setup');
    expect(allValues).toContain('/config ver');
    expect(allValues).toContain('/config rol-admin');
  });
});

// El bloque solo debía tocar Administración — el resto de las categorías de /helpstaff
// tiene que seguir exactamente como estaba.
describe('/helpstaff — otras categorías intactas', () => {
  // Auditoría UX/UI (2026-09-18): reestructurado en 2 campos (Tier 1 / Tier 2) para que
  // /say (el único comando Tier 2 de esta categoría) no quede escondido en el texto de
  // un campo — los comandos siguen siendo los mismos, solo cambió el agrupamiento.
  it('Moderación separa Tier 1 ("Cualquier staff") de Tier 2 ("Solo Administrador", /say)', () => {
    const embed = buildModeracionEmbed();
    const names = embed.data.fields.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(['🟢 Cualquier staff', '🔒 Solo Administrador']));

    const staffField = embed.data.fields.find((f) => f.name === '🟢 Cualquier staff');
    for (const cmd of ['/clear', '/lock', '/unlock', '/kick', '/ban', '/timeout', '/voice']) {
      expect(staffField.value).toContain(cmd);
    }

    const adminField = embed.data.fields.find((f) => f.name === '🔒 Solo Administrador');
    expect(adminField.value).toContain('/say');
  });

  it('Advertencias y sanciones sigue con sus comandos de siempre', () => {
    const value = buildAdvertenciasEmbed().data.fields.map((f) => f.value).join('\n');
    expect(value).toContain('/warn <usuario> <motivo>');
    expect(value).toContain('/sanciones');
  });

  it('Sorteos y anuncios, Economía, Roles, XP y Bot siguen sin cambios de estructura', () => {
    expect(buildSorteosAnunciosEmbed().data.fields.length).toBeGreaterThan(0);
    expect(buildEconomiaEmbed().data.fields.length).toBeGreaterThan(0);
    expect(buildRolesEmbed().data.fields.length).toBeGreaterThan(0);
    expect(buildXpEmbed().data.fields.length).toBeGreaterThan(0);
    expect(buildBotEmbed().data.fields.length).toBeGreaterThan(0);
  });
});
