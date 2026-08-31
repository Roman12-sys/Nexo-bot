import { vi, describe, it, expect, beforeEach } from 'vitest';

// FASE 1.1 (cierre de la Fase 1, 2026-08-30) — increment_inventory_item ahora puede
// rechazar con insufficient_inventory (RPC guard atómico contra cantidades negativas,
// ver schema.sql) cuando dos features distintas consumen el mismo ítem casi al mismo
// tiempo (el pre-check de cada comando lee bajo SU PROPIO lock — "vender:..." vs
// "pet:..." — que no se excluyen entre sí). economyStore.incrementInventoryItem ya
// mapeaba ese error a .code, pero ningún caller lo atrapaba — llegaba al catch genérico
// de interactionCreate.js ("Ocurrió un error inesperado"), técnicamente seguro pero mala
// UX para algo que es, en el fondo, una respuesta de negocio normal ("ya no te queda
// eso"). Este archivo cubre los dos callers reales con delta negativo (/vender, /pet
// alimentar) — /buy siempre usa delta +1, así que insufficient_inventory no puede
// pasarle nunca (current + 1 nunca da negativo si current >= 0); no se le agregó manejo
// porque no hay escenario real que lo dispare.
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

describe('/pet alimentar — manejo de insufficient_inventory', () => {
  let execute, getPet, feedPet;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../src/utils/petsStore.js', async (importOriginal) => {
      const actual = await importOriginal();
      return { ...actual, getPet: vi.fn(), feedPet: vi.fn(), createPet: vi.fn(), renamePet: vi.fn(), playWithPet: vi.fn(), recordBattleResult: vi.fn() };
    });
    vi.doMock('../src/utils/petCardImage.js', () => ({ buildPetCardAttachment: vi.fn().mockResolvedValue({}) }));

    ({ execute } = await import('../src/commands/economia/pet.js'));
    ({ getPet, feedPet } = await import('../src/utils/petsStore.js'));
  });

  const foodItem = { id: 'comida-1', type: 'pet_food', name: 'Croquetas' };
  const pet = {
    name: 'Rex', species: 'perro', level: 1, xp: 20, hunger: 80, happiness: 80,
    lastFed: Date.now(), lastPlayed: Date.now(), wins: 0, losses: 0,
  };

  it('insufficient_inventory produce una respuesta de negocio clara, nunca llega a feedPet', async () => {
    getPet.mockResolvedValue(pet);
    getGuildShopItems.mockResolvedValue([foodItem]);
    getUserEconomy.mockResolvedValue({ inventory: { 'comida-1': 1 } });
    incrementInventoryItem.mockRejectedValue(insufficientInventoryError());
    const interaction = makeInteraction({ options: { subcommand: 'alimentar' } });

    await expect(execute(interaction)).resolves.not.toThrow();

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Croquetas') }),
    );
    const message = interaction.editReply.mock.calls.at(-1)[0].content;
    expect(message).not.toMatch(/error inesperado/i);
    expect(feedPet).not.toHaveBeenCalled();
  });

  it('un error genérico de la DB sigue propagándose, no se oculta', async () => {
    getPet.mockResolvedValue(pet);
    getGuildShopItems.mockResolvedValue([foodItem]);
    getUserEconomy.mockResolvedValue({ inventory: { 'comida-1': 1 } });
    incrementInventoryItem.mockRejectedValue(genericDbError());
    const interaction = makeInteraction({ options: { subcommand: 'alimentar' } });

    await expect(execute(interaction)).rejects.toThrow('connection refused');
    expect(feedPet).not.toHaveBeenCalled();
  });

  it('caso normal (sin error): sigue alimentando como antes', async () => {
    getPet.mockResolvedValue(pet);
    getGuildShopItems.mockResolvedValue([foodItem]);
    getUserEconomy.mockResolvedValue({ inventory: { 'comida-1': 1 } });
    incrementInventoryItem.mockResolvedValue({ 'comida-1': 0 });
    feedPet.mockResolvedValue({ ...pet, hunger: 100, leveledUp: false });
    const interaction = makeInteraction({ options: { subcommand: 'alimentar' } });

    await execute(interaction);

    expect(incrementInventoryItem).toHaveBeenCalledWith('guild-1', 'user-1', 'comida-1', -1);
    expect(feedPet).toHaveBeenCalledWith('guild-1', 'user-1');
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Rex') }));
  });
});
