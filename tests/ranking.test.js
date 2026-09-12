import { vi, describe, it, expect, beforeEach } from 'vitest';

// /ranking no tenía ningún test propio pese a tener paginación real (mismo patrón que
// /leaderboard). Plan de ejecución post-auditoría, Fase 3 (PERF-1): getGuildXp (traía
// TODA la tabla xp del server) fue reemplazado por getGuildXpPage, que pagina de verdad
// en el backend (COUNT + range()). Este mock simula ese contrato exacto sobre un array
// en memoria — la implementación real ya tiene su propia cobertura en xpStore.test.js.
let XP_ROWS = [];
const PAGE_SIZE = 10;
const getGuildXpPage = vi.fn(async (guildId, { page, pageSize }) => {
  const sorted = [...XP_ROWS].sort((a, b) => b.xp - a.xp);
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(Math.max(0, page), totalPages - 1);
  const rows = total === 0 ? [] : sorted.slice(clampedPage * pageSize, clampedPage * pageSize + pageSize);
  return { rows, total, clampedPage, totalPages };
});
vi.mock('../src/utils/xpStore.js', () => ({ getGuildXpPage: (...a) => getGuildXpPage(...a) }));

const { execute, buildRankingEmbed } = await import('../src/commands/xp/ranking.js');
const { routeButton } = await import('../src/components/buttons.js');

function makeInteraction({ guildId = 'guild-1' } = {}) {
  return {
    guild: { id: guildId },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

function makeUsers(count) {
  return Array.from({ length: count }, (_, i) => ({ userId: `user-${i + 1}`, xp: (count - i) * 1000, level: count - i, prestige: 0 }));
}

beforeEach(() => {
  vi.clearAllMocks();
  XP_ROWS = [];
});

describe('/ranking — lógica básica', () => {
  it('sin nadie con XP: mensaje explícito, no una lista vacía muda', async () => {
    const interaction = makeInteraction();

    await execute(interaction);

    const embed = interaction.editReply.mock.calls[0][0].embeds[0];
    expect(embed.data.description).toContain('Todavía nadie ganó XP');
  });

  it('top 3 lleva medalla, el resto número', async () => {
    XP_ROWS = makeUsers(5);
    const interaction = makeInteraction();

    await execute(interaction);

    const embed = interaction.editReply.mock.calls[0][0].embeds[0];
    const lines = embed.data.description.split('\n');
    expect(lines[0]).toContain('🥇');
    expect(lines[1]).toContain('🥈');
    expect(lines[2]).toContain('🥉');
    expect(lines[3]).toContain('4.');
  });

  it('con prestigio: muestra la insignia ⭐×N', async () => {
    XP_ROWS = [{ userId: 'user-1', xp: 5000, level: 50, prestige: 2 }];
    const interaction = makeInteraction();

    await execute(interaction);

    const embed = interaction.editReply.mock.calls[0][0].embeds[0];
    expect(embed.data.description).toContain('⭐×2');
  });

  it('con 15 usuarios: la página 0 muestra los primeros 10 y "Siguiente" está habilitado', async () => {
    XP_ROWS = makeUsers(15);
    const interaction = makeInteraction();

    await execute(interaction);

    const embed = interaction.editReply.mock.calls[0][0].embeds[0];
    expect(embed.data.description.split('\n')).toHaveLength(10);
    expect(embed.data.footer.text).toContain('1/2');

    const row = interaction.editReply.mock.calls[0][0].components[0];
    const siguiente = row.components.find((b) => b.data.custom_id === 'ranking_page_1');
    expect(siguiente.data.disabled).toBe(false);
  });

  it('pide solo la página pedida (pageSize), nunca la tabla entera', async () => {
    XP_ROWS = makeUsers(15);
    const interaction = makeInteraction();

    await execute(interaction);

    expect(getGuildXpPage).toHaveBeenCalledWith('guild-1', { page: 0, pageSize: PAGE_SIZE });
  });
});

describe('/ranking — paginación real (botones)', () => {
  it('click en "Siguiente" avanza a la página 2 con los usuarios correctos', async () => {
    XP_ROWS = makeUsers(15);
    const interaction = { guild: { id: 'guild-1' }, customId: 'ranking_page_1', update: vi.fn().mockResolvedValue(undefined) };

    await routeButton(interaction);

    const embed = interaction.update.mock.calls[0][0].embeds[0];
    expect(embed.data.description).toContain('user-11');
    expect(embed.data.footer.text).toContain('2/2');
  });

  it('una página fuera de rango (ej. -1 por doble click) se clampea, nunca revienta', async () => {
    XP_ROWS = makeUsers(5);
    const interaction = { guild: { id: 'guild-1' }, customId: 'ranking_page_-1', update: vi.fn().mockResolvedValue(undefined) };

    await expect(routeButton(interaction)).resolves.not.toThrow();
    const embed = interaction.update.mock.calls[0][0].embeds[0];
    expect(embed.data.footer.text).toContain('1/1');
  });
});

describe('buildRankingEmbed — aislamiento entre guilds', () => {
  it('pide el ranking del guild correcto, nunca uno hardcodeado', async () => {
    await buildRankingEmbed('guild-especifico', 0);

    expect(getGuildXpPage).toHaveBeenCalledWith('guild-especifico', { page: 0, pageSize: PAGE_SIZE });
  });
});
