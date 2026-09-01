import { vi, describe, it, expect, beforeEach } from 'vitest';

// economia-staff.js — Fase 2B, sección 3: los dos handlers con componentes (paginado de
// historial, marcar compra pendiente como entregada) pasaron de un solo i.update() tras
// 1-2 awaits a i.deferUpdate() + i.editReply(), mismo motivo que sanciones.js.
const isStaff = vi.fn().mockResolvedValue(true);
vi.mock('../src/utils/permissions.js', () => ({ isStaff }));

const getUserTransactions = vi.fn().mockResolvedValue([]);
const getGuildShopItems = vi.fn().mockResolvedValue([]);
const getUserEconomy = vi.fn();
const addBalance = vi.fn();
const setBalance = vi.fn();
const getGuildPurchasesByReason = vi.fn().mockResolvedValue([]);
const markPurchaseDelivered = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/economyStore.js', () => ({
  getUserEconomy,
  addBalance,
  setBalance,
  getUserTransactions,
  getGuildPurchasesByReason,
  markPurchaseDelivered,
}));
vi.mock('../src/utils/shopStore.js', () => ({ getGuildShopItems }));

const { routeButton } = await import('../src/components/buttons.js');
const { routeSelect } = await import('../src/components/selects.js');
await import('../src/commands/moderacion/economiaStaff.js');

function makeInteraction(overrides = {}) {
  return {
    guildId: 'guild-1',
    client: { users: { fetch: vi.fn(async (id) => ({ id, tag: `user-${id}#0001` })) } },
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  isStaff.mockResolvedValue(true);
});

describe('ecostaff_hist_page_', () => {
  it('deferea (deferUpdate) antes de fetchear, y edita con editReply, no con update', async () => {
    getUserTransactions.mockResolvedValue([{ type: 'daily', amount: 100, balanceAfter: 100, timestamp: Date.now() }]);
    const interaction = makeInteraction({ customId: 'ecostaff_hist_page_0_target-1' });

    await routeButton(interaction);

    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(interaction.update).not.toHaveBeenCalled();
  });

  it('usuario no encontrado: edita el mensaje con el error, sin dejarlo colgado', async () => {
    const interaction = makeInteraction({
      customId: 'ecostaff_hist_page_0_ghost',
      client: { users: { fetch: vi.fn().mockResolvedValue(null) } },
    });

    await routeButton(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No se pudo encontrar') }));
  });
});

describe('ecostaff_pendiente_entregada', () => {
  it('deferea (deferUpdate) antes de marcar entregada, y edita con editReply', async () => {
    const interaction = makeInteraction({ customId: 'ecostaff_pendiente_entregada', values: ['42'] });

    await routeSelect(interaction);

    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(markPurchaseDelivered).toHaveBeenCalledWith(42);
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(interaction.update).not.toHaveBeenCalled();
  });
});
