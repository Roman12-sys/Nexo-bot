import { vi, describe, it, expect, beforeEach } from 'vitest';

// Auditoría UX/UI (2026-09-18), hallazgo Importante del Top 20: /shop (mirar) y /buy
// (comprar) eran dos comandos separados — ver y comprar exigía memorizar o copiar el
// nombre del ítem entre uno y otro. /shop suma un StringSelectMenu con los ítems de la
// página actual que dispara runBuy() (extraída de buy.js) directo, sin duplicar la
// lógica de cobro/entrega. runBuy se mockea acá a propósito — su propio comportamiento
// (rol borrado, reembolsos, las 4 ramas de ítem especial) ya está cubierto a fondo en
// buy.test.js; lo que hace falta probar acá es que /shop arma el select bien y delega
// al itemId correcto, nunca una segunda copia de esa lógica.
const runBuy = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/commands/economia/buy.js', () => ({ runBuy }));

const getGuildShopItems = vi.fn();
vi.mock('../src/utils/shopStore.js', () => ({ getGuildShopItems }));

const { execute: shopExecute } = await import('../src/commands/economia/shop.js');
const { routeButton } = await import('../src/components/buttons.js');
const { routeSelect } = await import('../src/components/selects.js');

function makeInteraction(overrides = {}) {
  return {
    guildId: 'guild-1',
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeItem(id, overrides = {}) {
  return { id, name: `Ítem ${id}`, price: 100, category: 'General', description: 'desc', ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/shop — select de compra', () => {
  it('sin ítems: no arma ningún select', async () => {
    getGuildShopItems.mockResolvedValue([]);
    const interaction = makeInteraction();

    await shopExecute(interaction);

    const payload = interaction.editReply.mock.calls[0][0];
    expect(payload.components).toEqual([]);
  });

  it('con ítems: el select trae una opción por ítem de la categoría actual, con su ID real como value', async () => {
    getGuildShopItems.mockResolvedValue([
      makeItem('item-1', { name: 'Espada', price: 500 }),
      makeItem('item-2', { name: 'Escudo', price: 300 }),
    ]);
    const interaction = makeInteraction();

    await shopExecute(interaction);

    const payload = interaction.editReply.mock.calls[0][0];
    const selectRow = payload.components.find((row) => row.components[0].data.custom_id === 'shop_buy_select');
    expect(selectRow).toBeDefined();
    const options = selectRow.components[0].options;
    expect(options.map((o) => o.data.value)).toEqual(['item-1', 'item-2']);
    expect(options.map((o) => o.data.label)).toEqual(['Espada', 'Escudo']);
  });

  it('categoría con más de 25 ítems: el select se corta en 25, nunca revienta', async () => {
    const items = Array.from({ length: 30 }, (_, i) => makeItem(`item-${i}`));
    getGuildShopItems.mockResolvedValue(items);
    const interaction = makeInteraction();

    await shopExecute(interaction);

    const payload = interaction.editReply.mock.calls[0][0];
    const selectRow = payload.components.find((row) => row.components[0].data.custom_id === 'shop_buy_select');
    expect(selectRow.components[0].options).toHaveLength(25);
  });

  it('paginar de categoría cambia el select a los ítems de la nueva página', async () => {
    getGuildShopItems.mockResolvedValue([
      makeItem('espada-1', { category: 'Armas' }),
      makeItem('pocion-1', { category: 'Pociones' }),
    ]);
    const interaction = makeInteraction({ customId: 'shop_page_1' });

    await routeButton(interaction);

    const payload = interaction.update.mock.calls[0][0];
    const selectRow = payload.components.find((row) => row.components[0].data.custom_id === 'shop_buy_select');
    expect(selectRow.components[0].options.map((o) => o.data.value)).toEqual(['pocion-1']);
  });

  // El mensaje de /shop es público y compartido — el select NUNCA debe pisarlo con
  // interaction.update(); runBuy() responde con su propio mensaje sobre esta misma
  // interaction, dejando el catálogo intacto para todos los demás.
  it('elegir un ítem del select delega en runBuy con el itemId elegido, sin tocar el panel compartido', async () => {
    const interaction = makeInteraction({ customId: 'shop_buy_select', values: ['item-2'] });

    await routeSelect(interaction);

    expect(runBuy).toHaveBeenCalledWith(interaction, 'item-2');
    expect(interaction.update).not.toHaveBeenCalled();
  });
});
