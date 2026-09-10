import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createSupabaseMock } from './helpers/supabaseMock.js';

// Auditoría Ciclo 1 (hallazgo Medio) — escudo_antirobo (rob_shield) quedaba
// INALCANZABLE en cuanto un servidor agregaba su primer ítem propio:
// getGuildShopItems reemplaza el catálogo de ejemplo COMPLETO (todo o nada, a
// propósito — ver el comentario de shopStore.js: "no tiene sentido mezclar 'lo que
// vino con el bot' con lo que el servidor arma a propósito") y /shop-admin agregar no
// ofrecía `rob_shield` como `tipo`, así que no había forma de recrearlo. Se resolvió
// exponiendo `rob_shield` como una tercera opción de `tipo` (mismo criterio que
// xp_boost/mystery_box) — NO mezclando catálogos, que hubiera contradicho la decisión
// de diseño ya documentada.

const supabaseMock = createSupabaseMock();
vi.mock('../src/supabaseClient.js', () => ({ get supabase() { return supabaseMock; } }));

const { getGuildShopItems, addShopItem } = await import('../src/utils/shopStore.js');
const DEFAULT_ITEMS = (await import('../src/utils/shopItems.js')).default;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getGuildShopItems — catálogo por defecto (sin ítems propios)', () => {
  it('sin ítems propios: devuelve el catálogo de ejemplo, que incluye rob_shield', async () => {
    supabaseMock.getBuilder('shop_items').__setResult({ data: [], error: null });

    const items = await getGuildShopItems('guild-1');

    expect(items).toEqual(DEFAULT_ITEMS);
    expect(items.some((i) => i.type === 'rob_shield')).toBe(true);
  });
});

describe('getGuildShopItems — con ítems propios (comportamiento todo-o-nada, sin cambios)', () => {
  it('con al menos un ítem propio: el catálogo de ejemplo deja de mostrarse por completo', async () => {
    supabaseMock.getBuilder('shop_items').__setResult({
      data: [{ item_id: 'mi_item', name: 'Mi ítem', description: '', category: 'General', price: 100, role_id: null, fulfillment: null, type: null }],
      error: null,
    });

    const items = await getGuildShopItems('guild-1');

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('mi_item');
    expect(items.some((i) => i.id === 'escudo_antirobo')).toBe(false);
  });

  it('custom + rob_shield: si el propio catálogo incluye un ítem type=rob_shield, vuelve a estar disponible', async () => {
    supabaseMock.getBuilder('shop_items').__setResult({
      data: [
        { item_id: 'mi_item', name: 'Mi ítem', description: '', category: 'General', price: 100, role_id: null, fulfillment: null, type: null },
        { item_id: 'mi_escudo', name: 'Mi escudo', description: 'Escudo propio', category: 'Diversión', price: 300, role_id: null, fulfillment: null, type: 'rob_shield' },
      ],
      error: null,
    });

    const items = await getGuildShopItems('guild-1');

    const shield = items.find((i) => i.type === 'rob_shield');
    expect(shield).toBeDefined();
    expect(shield.id).toBe('mi_escudo');
  });

  it('guild A y guild B tienen catálogos propios aislados', async () => {
    const builder = supabaseMock.getBuilder('shop_items');
    // El mock no filtra por guild_id solo (siempre devuelve el mismo __setResult
    // configurado), así que se verifica el aislamiento confirmando que la query real
    // se arma con el guild_id correcto en cada llamada — mismo criterio que el resto de
    // los stores de este proyecto (guild_id siempre viaja en el .eq()).
    builder.__setResult({ data: [], error: null });

    await getGuildShopItems('guild-a');
    await getGuildShopItems('guild-b');

    expect(builder.eq).toHaveBeenCalledWith('guild_id', 'guild-a');
    expect(builder.eq).toHaveBeenCalledWith('guild_id', 'guild-b');
  });
});

describe('addShopItem — persiste el tipo pedido (incluido rob_shield)', () => {
  it('guarda type: "rob_shield" tal cual se lo pasan', async () => {
    const builder = supabaseMock.getBuilder('shop_items');
    builder.__setResult({ error: null });

    await addShopItem('guild-1', {
      name: 'Escudo Personalizado',
      description: 'Protección custom',
      category: 'Diversión',
      price: 500,
      roleId: null,
      fulfillment: null,
      type: 'rob_shield',
    });

    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ guild_id: 'guild-1', type: 'rob_shield', item_id: 'escudo_personalizado' }),
    );
  });
});
