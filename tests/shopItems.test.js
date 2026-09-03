import { describe, it, expect } from 'vitest';
import DEFAULT_ITEMS from '../src/utils/shopItems.js';

// Fase 3B (eliminación de Pets, 2026-09-01) — comida_mascota dependía de /pet alimentar
// (buscaba type:'pet_food' en el inventario); sin ese comando, quedaba funcionalmente
// muerto, así que se sacó del catálogo. amuleto_mascota no tenía ningún type ni lógica
// propia — solo el texto lo ataba a Pets — así que se retexturizó en vez de borrarse
// (ver CLAUDE.md, "Fase 3B"). Este archivo no existía antes; se agrega para dejar ambas
// decisiones como invariantes verificables, no solo documentadas en prosa.
describe('shopItems (catálogo de ejemplo) — sin Pets', () => {
  it('no queda ningún ítem de type "pet_food"', () => {
    expect(DEFAULT_ITEMS.some((item) => item.type === 'pet_food')).toBe(false);
  });

  it('comida_mascota ya no existe en el catálogo', () => {
    expect(DEFAULT_ITEMS.some((item) => item.id === 'comida_mascota')).toBe(false);
  });

  it('amuleto_mascota sigue existiendo (retexturizado) pero sin referenciar /pet ni "mascota"', () => {
    const item = DEFAULT_ITEMS.find((item) => item.id === 'amuleto_mascota');
    expect(item).toBeDefined();
    expect(`${item.name} ${item.description}`).not.toMatch(/pet|mascota/i);
  });
});
