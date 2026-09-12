import { vi, describe, it, expect, beforeEach } from 'vitest';

// /owner-metricas — plan de ejecución post-auditoría, Fase 5 (2026-09-12). Único
// comando cross-guild del proyecto: gatea por isBotOwner() (identidad real), NUNCA por
// isStaff()/isAdmin() (rol de UN guild puntual) — un admin de un server de cliente
// jamás debería poder ver cuántos servidores tiene el bot en total.
const isBotOwner = vi.fn();
vi.mock('../src/utils/botOwner.js', () => ({ isBotOwner: (...a) => isBotOwner(...a) }));

const getGuildEventCounts = vi.fn();
vi.mock('../src/utils/botGuildEventsStore.js', () => ({ getGuildEventCounts: (...a) => getGuildEventCounts(...a) }));

const { execute } = await import('../src/commands/admin/ownerMetricas.js');

function makeInteraction({ userId = 'user-1', guildCount = 42 } = {}) {
  return {
    user: { id: userId },
    client: { guilds: { cache: { size: guildCount } } },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getGuildEventCounts.mockResolvedValue({ joins: 0, leaves: 0 });
});

describe('/owner-metricas — permisos (gate por identidad real, no por rol de guild)', () => {
  it('no es el dueño del bot: rechazado, ni siquiera llega a deferReply', async () => {
    isBotOwner.mockResolvedValue(false);
    const interaction = makeInteraction({ userId: 'admin-de-un-cliente' });

    await execute(interaction);

    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(getGuildEventCounts).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No tenés permisos') }));
  });

  it('es el dueño del bot: pasa, arma el embed', async () => {
    isBotOwner.mockResolvedValue(true);
    const interaction = makeInteraction();

    await execute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
  });
});

describe('/owner-metricas — contenido', () => {
  beforeEach(() => {
    isBotOwner.mockResolvedValue(true);
  });

  it('muestra el total real de guilds en memoria (client.guilds.cache.size)', async () => {
    const interaction = makeInteraction({ guildCount: 137 });

    await execute(interaction);

    const embed = interaction.editReply.mock.calls[0][0].embeds[0];
    expect(embed.data.fields[0].value).toContain('137');
  });

  it('pide los conteos de 7 y 30 días con ventanas distintas', async () => {
    const interaction = makeInteraction();
    await execute(interaction);

    expect(getGuildEventCounts).toHaveBeenCalledTimes(2);
    const [sinceA] = getGuildEventCounts.mock.calls[0];
    const [sinceB] = getGuildEventCounts.mock.calls[1];
    expect(sinceA).toBeGreaterThan(sinceB); // 7 días atrás es MÁS reciente que 30 días atrás
  });

  it('neto negativo (más bajas que altas) se muestra con signo, no como "+-3"', async () => {
    getGuildEventCounts.mockResolvedValue({ joins: 1, leaves: 4 });
    const interaction = makeInteraction();

    await execute(interaction);

    const embed = interaction.editReply.mock.calls[0][0].embeds[0];
    expect(embed.data.fields[1].value).toContain('neto -3');
    expect(embed.data.fields[1].value).not.toContain('neto +-3');
  });
});
