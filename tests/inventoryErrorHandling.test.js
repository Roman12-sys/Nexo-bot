import { vi, describe, it, expect, beforeEach } from 'vitest';

// FASE 1.1 (cierre de la Fase 1, 2026-08-30) — increment_inventory_item ahora puede
// rechazar con insufficient_inventory (RPC guard atómico contra cantidades negativas,
// ver schema.sql) cuando dos features distintas consumen el mismo ítem casi al mismo
// tiempo (el pre-check de cada comando lee bajo SU PROPIO lock, que no se excluye con
// el de otra feature). economyStore.incrementInventoryItem ya mapeaba ese error a
// .code, pero ningún caller lo atrapaba — llegaba al catch genérico de
// interactionCreate.js ("Ocurrió un error inesperado"), técnicamente seguro pero mala
// UX para algo que es, en el fondo, una respuesta de negocio normal ("ya no te queda
// eso"). Este archivo cubre /vender, el caller real con delta negativo — /buy siempre
// usa delta +1, así que insufficient_inventory no puede pasarle nunca (current + 1
// nunca da negativo si current >= 0); no se le agregó manejo porque no hay escenario
// real que lo dispare.
const getShopItem = vi.fn();
const getGuildShopItems = vi.fn();
vi.mock('../src/utils/shopStore.js', () => ({ getShopItem, getGuildShopItems }));

const getUserEconomy = vi.fn();
const incrementInventoryItem = vi.fn();
const addBalance = vi.fn();
const deductBalanceIfSufficient = vi.fn();
vi.mock('../src/utils/economyStore.js', () => ({
  getUserEconomy,
  incrementInventoryItem,
  addBalance,
  deductBalanceIfSufficient,
}));

vi.mock('../src/supabaseClient.js', () => ({ supabase: {} }));

function insufficientInventoryError() {
  const error = new Error('insufficient_inventory');
  error.code = 'insufficient_inventory';
  return error;
}

function genericDbError() {
  return new Error('connection refused');
}

function makeInteraction({ userId = 'user-1', guildId = 'guild-1', options = {} } = {}) {
  return {
    guild: { id: guildId },
    guildId,
    user: { id: userId },
    options: {
      getString: (name) => options[name] ?? null,
      getSubcommand: () => options.subcommand ?? null,
    },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/vender — manejo de insufficient_inventory', () => {
  let execute;
  beforeEach(async () => {
    vi.resetModules();
    ({ execute } = await import('../src/commands/economia/vender.js'));
  });

  const item = { id: 'pocion', name: 'Poción', price: 100, roleId: null };

  it('insufficient_inventory produce una respuesta de negocio clara, no el error genérico', async () => {
    getShopItem.mockResolvedValue(item);
    getUserEconomy.mockResolvedValue({ inventory: { pocion: 1 } });
    incrementInventoryItem.mockRejectedValue(insufficientInventoryError());
    const interaction = makeInteraction({ options: { item: 'pocion' } });

    await expect(execute(interaction)).resolves.not.toThrow();

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Poción') }),
    );
    const message = interaction.editReply.mock.calls.at(-1)[0].content;
    expect(message).not.toMatch(/error inesperado/i);
    expect(addBalance).not.toHaveBeenCalled(); // no se le paga por algo que no se pudo vender
  });

  it('un error genérico de la DB (no insufficient_inventory) sigue propagándose, no se oculta', async () => {
    getShopItem.mockResolvedValue(item);
    getUserEconomy.mockResolvedValue({ inventory: { pocion: 1 } });
    incrementInventoryItem.mockRejectedValue(genericDbError());
    const interaction = makeInteraction({ options: { item: 'pocion' } });

    await expect(execute(interaction)).rejects.toThrow('connection refused');
    expect(addBalance).not.toHaveBeenCalled();
  });

  it('caso normal (sin error): sigue vendiendo como antes', async () => {
    getShopItem.mockResolvedValue(item);
    getUserEconomy.mockResolvedValue({ inventory: { pocion: 3 } });
    incrementInventoryItem.mockResolvedValue({ pocion: 2 });
    addBalance.mockResolvedValue(1050);
    const interaction = makeInteraction({ options: { item: 'pocion' } });

    await execute(interaction);

    expect(incrementInventoryItem).toHaveBeenCalledWith('guild-1', 'user-1', 'pocion', -1);
    expect(addBalance).toHaveBeenCalledWith('guild-1', 'user-1', 50, { type: 'sell', reason: 'Poción' });
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
  });
});
