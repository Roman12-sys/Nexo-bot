import { vi, describe, it, expect, beforeEach } from 'vitest';

// Auditoría completa NEXO (2026-09-11): /leaderboard no tenía ningún test propio pese a
// tener paginación real (mismo patrón que /ranking) — medallas para el top 3, números
// para el resto, botones que se deshabilitan en los bordes.
const getGuildEconomy = vi.fn();
vi.mock('../src/utils/economyStore.js', () => ({ getGuildEconomy: (...a) => getGuildEconomy(...a) }));

const { execute, buildLeaderboardEmbed } = await import('../src/commands/economia/leaderboard.js');
const { routeButton } = await import('../src/components/buttons.js');

function makeInteraction({ guildId = 'guild-1' } = {}) {
  return {
    guild: { id: guildId },
    guildId,
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
  };
}

function makeUsers(count) {
  return Array.from({ length: count }, (_, i) => ({ userId: `user-${i + 1}`, balance: (count - i) * 100 }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/leaderboard — lógica básica', () => {
  it('sin nadie con monedas registradas: mensaje explícito, no una lista vacía muda', async () => {
    getGuildEconomy.mockResolvedValue([]);
    const interaction = makeInteraction();

    await execute(interaction);

    const embed = interaction.editReply.mock.calls[0][0].embeds[0];
    expect(embed.data.description).toContain('Todavía nadie');
  });

  it('top 3 lleva medalla, el resto número — en el orden real que ya viene ordenado', async () => {
    getGuildEconomy.mockResolvedValue(makeUsers(5));
    const interaction = makeInteraction();

    await execute(interaction);

    const embed = interaction.editReply.mock.calls[0][0].embeds[0];
    const lines = embed.data.description.split('\n');
    expect(lines[0]).toContain('🥇');
    expect(lines[1]).toContain('🥈');
    expect(lines[2]).toContain('🥉');
    expect(lines[3]).toContain('4.');
    expect(lines[4]).toContain('5.');
  });

  it('una sola página (≤10 usuarios): el botón "Siguiente" queda deshabilitado', async () => {
    getGuildEconomy.mockResolvedValue(makeUsers(5));
    const interaction = makeInteraction();

    await execute(interaction);

    const row = interaction.editReply.mock.calls[0][0].components[0];
    const anterior = row.components.find((b) => b.data.custom_id === 'leaderboard_page_-1');
    const siguiente = row.components.find((b) => b.data.custom_id === 'leaderboard_page_1');
    expect(anterior.data.disabled).toBe(true);
    expect(siguiente.data.disabled).toBe(true);
  });

  it('con 15 usuarios: la página 0 muestra los primeros 10 y "Siguiente" está habilitado', async () => {
    getGuildEconomy.mockResolvedValue(makeUsers(15));
    const interaction = makeInteraction();

    await execute(interaction);

    const embed = interaction.editReply.mock.calls[0][0].embeds[0];
    expect(embed.data.description.split('\n')).toHaveLength(10);
    expect(embed.data.footer.text).toContain('1/2');

    const row = interaction.editReply.mock.calls[0][0].components[0];
    const siguiente = row.components.find((b) => b.data.custom_id === 'leaderboard_page_1');
    expect(siguiente.data.disabled).toBe(false);
  });
});

describe('/leaderboard — paginación real (botones)', () => {
  it('click en "Siguiente" avanza a la página 2 con los usuarios correctos', async () => {
    getGuildEconomy.mockResolvedValue(makeUsers(15));
    const interaction = { guild: { id: 'guild-1' }, guildId: 'guild-1', customId: 'leaderboard_page_1', update: vi.fn().mockResolvedValue(undefined) };

    await routeButton(interaction);

    const embed = interaction.update.mock.calls[0][0].embeds[0];
    expect(embed.data.description).toContain('user-11'); // el 11vo, primero de la página 2
    expect(embed.data.footer.text).toContain('2/2');
  });

  it('una página fuera de rango (ej. -1 por doble click) se clampea, nunca revienta', async () => {
    getGuildEconomy.mockResolvedValue(makeUsers(5));
    const interaction = { guild: { id: 'guild-1' }, guildId: 'guild-1', customId: 'leaderboard_page_-1', update: vi.fn().mockResolvedValue(undefined) };

    await expect(routeButton(interaction)).resolves.not.toThrow();
    const embed = interaction.update.mock.calls[0][0].embeds[0];
    expect(embed.data.footer.text).toContain('1/1');
  });
});

describe('buildLeaderboardEmbed — aislamiento entre guilds', () => {
  it('pide el ranking del guild correcto, nunca uno hardcodeado', async () => {
    getGuildEconomy.mockResolvedValue([]);
    await buildLeaderboardEmbed('guild-especifico', 0);

    expect(getGuildEconomy).toHaveBeenCalledWith('guild-especifico');
  });
});
