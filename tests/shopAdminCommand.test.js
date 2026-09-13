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
const getShopItem = vi.fn().mockResolvedValue(null);
vi.mock('../src/utils/shopStore.js', () => ({
  getGuildShopItems: vi.fn().mockResolvedValue([]),
  getShopItem,
  addShopItem,
  updateShopItem: vi.fn(),
  removeShopItem: vi.fn(),
  hasCustomShopItems,
}));

// isAdmin, no isStaff — auditoría 2026-09-12, hallazgo de economía #1: /shop-admin
// puede acreditar monedas sin límite (caja misteriosa), así que exige Tier 2 igual que
// /economia-staff y /xp, no Tier 1.
const isAdmin = vi.fn().mockResolvedValue(true);
vi.mock('../src/utils/permissions.js', () => ({ isAdmin }));

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
  getShopItem.mockResolvedValue(null);
  isAdmin.mockResolvedValue(true);
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

// Auditoría 2026-09-12, hallazgo de economía #1: un moderador (Tier 1, sin
// admin_role_id) podía crear una caja misteriosa a precio 1 y farmearla con /buy,
// imprimiendo dinero sin límite — el mismo vector que /economia-staff y /xp ya
// cerraron exigiendo isAdmin(). Regresión: confirma que el comando entero (no solo
// "agregar") queda bloqueado para un Tier 1 puro.
describe('/shop-admin — gate de permisos (Tier 2, no Tier 1)', () => {
  it('un Tier 1 puro (isAdmin false) es rechazado sin llamar a addShopItem', async () => {
    isAdmin.mockResolvedValue(false);
    const interaction = makeAgregarInteraction({ tipo: 'mystery_box', precio: 1 });

    await execute(interaction);

    expect(addShopItem).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('administrador') }));
  });
});

// Auditoría 2026-09-12, hallazgo de economía #1 (defensa en profundidad): incluso un
// Tier 2 legítimo no puede crear una caja misteriosa con un precio que la vuelva
// ganancia neta para quien la compre (payout real: 50-400 monedas al azar).
describe('/shop-admin agregar — piso de precio para mystery_box', () => {
  it('rechaza un precio menor a MAX_MYSTERY (400) sin llamar a addShopItem', async () => {
    const interaction = makeAgregarInteraction({ tipo: 'mystery_box', precio: 1 });

    await execute(interaction);

    expect(addShopItem).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('caja misteriosa') }));
  });

  it('acepta un precio igual o mayor a MAX_MYSTERY (400)', async () => {
    const interaction = makeAgregarInteraction({ tipo: 'mystery_box', precio: 400 });

    await execute(interaction);

    expect(addShopItem).toHaveBeenCalledWith('guild-1', expect.objectContaining({ type: 'mystery_box' }));
  });
});
