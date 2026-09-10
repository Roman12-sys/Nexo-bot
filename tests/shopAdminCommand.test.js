import { vi, describe, it, expect, beforeEach } from 'vitest';

// /shop-admin agregar — confirma que la opción `tipo` (ahora con 3 choices: xp_boost,
// mystery_box, rob_shield — ver auditoría Ciclo 1, hallazgo Medio) llega intacta hasta
// addShopItem. Archivo separado de shopAdmin.test.js a propósito: ese testea
// shopStore.js REAL contra Supabase mockeado; acá se mockea shopStore.js entero para
// probar solo el wiring del comando — mezclar los dos en un archivo no es posible
// (vi.mock está scoped a nivel de archivo, no se puede tener la versión real y la
// mockeada del mismo módulo en el mismo archivo de test).
const addShopItem = vi.fn().mockResolvedValue('mi-escudo');
const hasCustomShopItems = vi.fn().mockResolvedValue(true);
vi.mock('../src/utils/shopStore.js', () => ({
  getGuildShopItems: vi.fn().mockResolvedValue([]),
  addShopItem,
  updateShopItem: vi.fn(),
  removeShopItem: vi.fn(),
  hasCustomShopItems,
}));

const isStaff = vi.fn().mockResolvedValue(true);
vi.mock('../src/utils/permissions.js', () => ({ isStaff }));

const { execute } = await import('../src/commands/economia/shopAdmin.js');

function makeAgregarInteraction(overrides = {}) {
  const options = {
    nombre: 'Mi escudo',
    precio: 500,
    descripcion: null,
    categoria: null,
    entrega_manual: null,
    tipo: null,
    ...overrides,
  };
  return {
    guildId: 'guild-1',
    options: {
      getSubcommand: () => 'agregar',
      getString: (name) => options[name] ?? null,
      getInteger: (name) => options[name] ?? null,
      getBoolean: (name) => options[name] ?? null,
      getRole: () => null,
    },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  addShopItem.mockResolvedValue('mi-escudo');
  hasCustomShopItems.mockResolvedValue(true);
  isStaff.mockResolvedValue(true);
});

describe('/shop-admin agregar — wiring de la opción "tipo"', () => {
  it('tipo: "rob_shield" se pasa tal cual a addShopItem', async () => {
    const interaction = makeAgregarInteraction({ tipo: 'rob_shield' });

    await execute(interaction);

    expect(addShopItem).toHaveBeenCalledWith('guild-1', expect.objectContaining({ type: 'rob_shield' }));
  });

  it('tipo: "xp_boost" y "mystery_box" siguen andando (sin regresión)', async () => {
    await execute(makeAgregarInteraction({ tipo: 'xp_boost' }));
    expect(addShopItem).toHaveBeenCalledWith('guild-1', expect.objectContaining({ type: 'xp_boost' }));

    await execute(makeAgregarInteraction({ tipo: 'mystery_box' }));
    expect(addShopItem).toHaveBeenCalledWith('guild-1', expect.objectContaining({ type: 'mystery_box' }));
  });

  it('sin tipo: se pasa null (ítem normal)', async () => {
    await execute(makeAgregarInteraction({ tipo: null }));
    expect(addShopItem).toHaveBeenCalledWith('guild-1', expect.objectContaining({ type: null }));
  });
});
