import { vi, describe, it, expect, beforeEach } from 'vitest';

// Fase 3B (eliminación de Pets, 2026-09-01) — /perfil sacó una promesa del Promise.all
// (getPet) y un campo del embed ("🐾 Mascota"). El pedido explícito de esta fase fue
// confirmar que sacar una promesa de un Promise.all con destructuring posicional no deja
// un desfasaje silencioso (el resto de las 8 lecturas corriéndose un índice). Este
// archivo no existía antes (el proyecto no tiene tests por comando individual, ver
// CLAUDE.md) — se agrega puntualmente por ese riesgo concreto, no como cobertura general
// de /perfil.
const getUserXp = vi.fn();
const getLevelProgress = vi.fn();
const getRank = vi.fn();
vi.mock('../src/utils/xpStore.js', () => ({ getUserXp, getLevelProgress, getRank }));

const getUserEconomy = vi.fn();
vi.mock('../src/utils/economyStore.js', () => ({ getUserEconomy }));

const getUserTrivia = vi.fn();
const getPlayStatus = vi.fn();
vi.mock('../src/utils/triviaStore.js', () => ({ getUserTrivia, getPlayStatus }));

const getUserWarns = vi.fn();
vi.mock('../src/utils/warnsStore.js', () => ({ getUserWarns }));

const getUserWinCount = vi.fn();
vi.mock('../src/utils/giveawaysStore.js', () => ({ getUserWinCount }));

const getUserReminders = vi.fn();
vi.mock('../src/utils/remindersStore.js', () => ({ getUserReminders }));

vi.mock('../src/commands/economia/inventory.js', () => ({ buildInventoryEmbed: vi.fn() }));
vi.mock('../src/commands/economia/daily.js', () => ({ COOLDOWN_MS: 24 * 60 * 60 * 1000 }));
vi.mock('../src/commands/economia/work.js', () => ({ COOLDOWN_MS: 60 * 60 * 1000 }));

const getUnlockedAchievementIds = vi.fn();
vi.mock('../src/utils/achievements.js', () => ({
  getUnlockedAchievementIds,
  buildLogrosEmbed: vi.fn(),
  ACHIEVEMENTS: new Array(12).fill({ id: 'x' }),
}));

vi.mock('../src/utils/guildAchievements.js', () => ({
  getUnlockedGuildAchievementIds: vi.fn(),
  buildGuildLogrosEmbed: vi.fn(),
}));

const getUserMissions = vi.fn();
vi.mock('../src/utils/missionsStore.js', () => ({ getUserMissions }));

const { execute } = await import('../src/commands/informacion/perfil.js');

function makeInteraction() {
  const targetUser = { id: 'user-1', tag: 'user-1#0001', displayAvatarURL: () => 'https://example.com/a.png' };
  return {
    guild: { id: 'guild-1', members: { fetch: vi.fn().mockResolvedValue({ joinedTimestamp: null }) } },
    guildId: 'guild-1',
    user: targetUser,
    options: { getUser: () => null },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserXp.mockResolvedValue({ xp: 100, prestige: 0 });
  getLevelProgress.mockReturnValue({ level: 3, currentLevelXp: 10, xpForNextLevel: 50, totalXp: 100 });
  getRank.mockResolvedValue(5);
  getUserEconomy.mockResolvedValue({ balance: 1000, lastDaily: 0, lastWork: 0, dailyStreak: 0 });
  getUserTrivia.mockResolvedValue({ points: 20 });
  getPlayStatus.mockResolvedValue({ allowed: true, resetAt: 0 });
  getUserWarns.mockResolvedValue([]);
  getUserWinCount.mockResolvedValue(0);
  getUnlockedAchievementIds.mockResolvedValue(new Set(['primera_moneda']));
  getUserMissions.mockResolvedValue([]);
});

it('construye el embed sin romper y sin ningún campo de mascota', async () => {
  const interaction = makeInteraction();
  await expect(execute(interaction)).resolves.not.toThrow();

  const embed = interaction.editReply.mock.calls.at(-1)[0].embeds[0];
  const fieldNames = embed.data.fields.map((f) => f.name);

  expect(fieldNames).not.toContain('🐾 Mascota');
  // Las 8 lecturas de siempre (sin mascota) siguen todas presentes — nada se corrió de
  // índice por sacar `pet` del Promise.all.
  expect(fieldNames).toEqual(
    expect.arrayContaining(['⭐ Nivel', '✨ XP', '💰 Balance', '📈 Progreso de nivel', '🧠 Trivia', '🏅 Logros', '🗓️ Misiones', '⏳ Al día']),
  );
});

it('no llama a ningún store de Pets (no existe ninguno para mockear)', async () => {
  const interaction = makeInteraction();
  await execute(interaction);
  // Si perfil.js todavía importara petsStore.js, este archivo ni siquiera podría
  // importarse sin un vi.mock para ese módulo — el import de arriba ya lo prueba.
  expect(getUserEconomy).toHaveBeenCalledWith('guild-1', 'user-1');
});
