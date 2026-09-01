import { vi, describe, it, expect, beforeEach } from 'vitest';

// /buy — Fase 2B, sección 11: un ítem cuyo rol configurado ya no existe en Discord no
// debe cobrar sin entregar nada. Dos capas: chequeo previo (guild.roles.cache, gratis y
// siempre completo) antes de cobrar, y rollback (reembolso + revertir inventario) si
// falla igual DESPUÉS de cobrar (condición de carrera real pero rara).
const getGuildShopItems = vi.fn().mockResolvedValue([]);
const getShopItem = vi.fn();
vi.mock('../src/utils/shopStore.js', () => ({ getGuildShopItems, getShopItem }));

const getUserEconomy = vi.fn();
const deductBalanceIfSufficient = vi.fn();
const incrementInventoryItem = vi.fn().mockResolvedValue({});
const addBalance = vi.fn();
const recordTransaction = vi.fn().mockResolvedValue(undefined);
const extendRobShield = vi.fn();
vi.mock('../src/utils/economyStore.js', () => ({
  getUserEconomy,
  deductBalanceIfSufficient,
  incrementInventoryItem,
  addBalance,
  recordTransaction,
  extendRobShield,
}));

const extendXpBoost = vi.fn();
vi.mock('../src/utils/xpStore.js', () => ({ extendXpBoost }));

const createShopPurchaseLogEmbed = vi.fn(() => ({}));
vi.mock('../src/utils/logEmbeds.js', () => ({ createShopPurchaseLogEmbed }));

const getGuildLogChannel = vi.fn().mockResolvedValue(null);
vi.mock('../src/utils/guildLogChannels.js', () => ({ getGuildLogChannel }));

const emit = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/eventBus.js', () => ({ eventBus: { emit } }));

const { execute: buyExecute } = await import('../src/commands/economia/buy.js');

const ROLE_ITEM = { id: 'item-1', name: 'Rol VIP', price: 500, roleId: 'role-vip', type: 'role', fulfillment: 'auto' };

function makeInteraction({ roleExists = true, member = null, options = { item: 'item-1' } } = {}) {
  const rolesCache = new Map(roleExists ? [['role-vip', { id: 'role-vip' }]] : []);
  return {
    guild: {
      id: 'guild-1',
      roles: { cache: rolesCache },
      members: { fetch: vi.fn(async () => member) },
    },
    guildId: 'guild-1',
    user: { id: 'user-1', tag: 'user-1#0001' },
    client: {},
    options: {
      getString: (name) => options[name] ?? null,
    },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMember({ hasRole = false, addImpl } = {}) {
  return {
    id: 'user-1',
    roles: {
      cache: { has: () => hasRole },
      add: addImpl || vi.fn().mockResolvedValue(undefined),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserEconomy.mockResolvedValue({ balance: 10_000 });
  deductBalanceIfSufficient.mockResolvedValue(9_500);
  getShopItem.mockResolvedValue(ROLE_ITEM);
});

describe('/buy — ítem con rol', () => {
  it('rol inexistente en el servidor: compra rechazada SIN cobrar', async () => {
    const interaction = makeInteraction({ roleExists: false });

    await buyExecute(interaction);

    expect(deductBalanceIfSufficient).not.toHaveBeenCalled();
    expect(incrementInventoryItem).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('ya no existe') }));
  });

  it('rol existente: compra normal, cobra y asigna el rol', async () => {
    const member = makeMember({ hasRole: false });
    const interaction = makeInteraction({ roleExists: true, member });

    await buyExecute(interaction);

    expect(deductBalanceIfSufficient).toHaveBeenCalledWith('guild-1', 'user-1', 500);
    expect(member.roles.add).toHaveBeenCalledWith('role-vip');
    expect(incrementInventoryItem).toHaveBeenCalledWith('guild-1', 'user-1', 'item-1', 1);
    expect(addBalance).not.toHaveBeenCalled(); // no hubo fallo, no hay reembolso
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Compraste') }));
  });

  it('ya tiene el rol: no cobra de nuevo', async () => {
    const member = makeMember({ hasRole: true });
    const interaction = makeInteraction({ roleExists: true, member });

    await buyExecute(interaction);

    expect(deductBalanceIfSufficient).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Ya tenés') }));
  });

  it('el rol se borra justo después de cobrar (condición de carrera): revierte inventario y reembolsa, nunca confirma éxito', async () => {
    const addError = new Error('Unknown Role');
    const member = makeMember({ hasRole: false, addImpl: vi.fn().mockRejectedValue(addError) });
    const interaction = makeInteraction({ roleExists: true, member });
    addBalance.mockResolvedValue(10_000); // balance vuelve al original tras el reembolso

    await buyExecute(interaction);

    expect(deductBalanceIfSufficient).toHaveBeenCalledWith('guild-1', 'user-1', 500);
    expect(incrementInventoryItem).toHaveBeenCalledWith('guild-1', 'user-1', 'item-1', -1); // revierte el +1 de antes
    expect(addBalance).toHaveBeenCalledWith('guild-1', 'user-1', 500, expect.objectContaining({ type: 'purchase_refund' }));

    const finalReply = interaction.editReply.mock.calls.at(-1)[0];
    expect(finalReply.content).toContain('reembolsaron');
    expect(finalReply.content).not.toContain('✅ Compraste');
  });

  it('si el reembolso también falla, no revienta — igual avisa que no se entregó nada', async () => {
    const addError = new Error('Unknown Role');
    const member = makeMember({ hasRole: false, addImpl: vi.fn().mockRejectedValue(addError) });
    const interaction = makeInteraction({ roleExists: true, member });
    addBalance.mockRejectedValue(new Error('supabase caído'));

    await expect(buyExecute(interaction)).resolves.toBeUndefined();

    const finalReply = interaction.editReply.mock.calls.at(-1)[0];
    expect(finalReply.content).toContain('reembolsaron');
  });
});
