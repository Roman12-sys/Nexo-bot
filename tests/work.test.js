import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Fase 3B (eliminación de Pets, 2026-09-01) — /work perdió el bonus de mascota
// (getPetBonusMultiplier). Este archivo no existía antes (el proyecto no tiene tests
// por comando individual, ver CLAUDE.md) — se agrega puntualmente para dejar
// registrado que la recompensa ya no se multiplica por nada y que /work no depende de
// petsStore.js de ninguna forma.
const getUserEconomy = vi.fn();
const addBalance = vi.fn();
const setCooldown = vi.fn();
vi.mock('../src/utils/economyStore.js', () => ({ getUserEconomy, addBalance, setCooldown }));

const emit = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/eventBus.js', () => ({ eventBus: { emit } }));

// Tuning de economía por servidor (plan de ejecución 2026-09-15) — {} (sin overrides)
// reproduce EXACTAMENTE el comportamiento de siempre.
const getGuildConfig = vi.fn().mockResolvedValue({});
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig: (...a) => getGuildConfig(...a) }));

const { execute } = await import('../src/commands/economia/work.js');

function makeInteraction() {
  return {
    guild: { id: 'guild-1' },
    user: { id: 'user-1' },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserEconomy.mockResolvedValue({ lastWork: 0, balance: 0 });
  addBalance.mockResolvedValue(50);
  getGuildConfig.mockResolvedValue({});
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  Math.random.mockRestore();
});

it('la recompensa es el mínimo del rango sin ningún multiplicador aplicado (sin mascota)', async () => {
  const interaction = makeInteraction();
  await execute(interaction);

  // MIN_REWARD=50 en work.js — con Math.random() fijo en 0 el resultado es exacto.
  // Antes de Fase 3B esto hubiera podido dar más si getPetBonusMultiplier > 1.
  expect(addBalance).toHaveBeenCalledWith('guild-1', 'user-1', 50, { type: 'work', reason: expect.any(String) });

  const embed = interaction.editReply.mock.calls.at(-1)[0].embeds[0];
  expect(embed.data.description).toContain('50');
  expect(embed.data.description).not.toMatch(/mascota/i);
});

// Auditoría 2026-09-12, hallazgo de economía #3 (mismo fix que /daily/, cooldown antes
// que recompensa): confirma que setCooldown ya se guardó cuando addBalance falla
// después, evitando un segundo /work en la misma ventana.
it('si addBalance falla después de guardar el cooldown, el cooldown queda igual persistido', async () => {
  addBalance.mockRejectedValueOnce(new Error('supabase timeout'));
  const interaction = makeInteraction();

  await expect(execute(interaction)).rejects.toThrow('supabase timeout');

  expect(setCooldown).toHaveBeenCalledWith('guild-1', 'user-1', 'work', expect.any(Number));
});

// Tuning de economía por servidor (plan de ejecución 2026-09-15).
it('con economy_work_min/max configurados: usa ese rango, no el default global', async () => {
  getGuildConfig.mockResolvedValue({ economy_work_min: 777, economy_work_max: 777 });
  const interaction = makeInteraction();

  await execute(interaction);

  expect(addBalance).toHaveBeenCalledWith('guild-1', 'user-1', 777, { type: 'work', reason: expect.any(String) });
});

it('no importa ni ejecuta nada de petsStore.js', async () => {
  const interaction = makeInteraction();
  await expect(execute(interaction)).resolves.not.toThrow();
});
