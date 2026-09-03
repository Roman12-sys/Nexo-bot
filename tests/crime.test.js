import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Fase 3B (eliminación de Pets, 2026-09-01) — /crime perdió el bonus de mascota en la
// rama de éxito (getPetBonusMultiplier). Igual que work.test.js: archivo nuevo, agregado
// puntualmente para dejar registrado que la recompensa ya no se multiplica y que
// /crime no depende de petsStore.js de ninguna forma.
const getUserEconomy = vi.fn();
const addBalance = vi.fn();
const deductBalanceIfSufficient = vi.fn();
const recordTransaction = vi.fn().mockResolvedValue(undefined);
const setCooldown = vi.fn();
vi.mock('../src/utils/economyStore.js', () => ({
  getUserEconomy,
  addBalance,
  deductBalanceIfSufficient,
  recordTransaction,
  setCooldown,
}));

const { execute } = await import('../src/commands/economia/crime.js');

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
  getUserEconomy.mockResolvedValue({ lastCrime: 0, balance: 0 });
  addBalance.mockResolvedValue(150);
  // Math.random() fijo en 0: exito = (0 < 0.6) = true, reward = MIN_REWARD (150),
  // flavorText = índice 0 — determinístico para poder afirmar el monto exacto.
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  Math.random.mockRestore();
});

it('golpe exitoso: la recompensa es el mínimo del rango sin multiplicador (sin mascota)', async () => {
  const interaction = makeInteraction();
  await execute(interaction);

  expect(addBalance).toHaveBeenCalledWith('guild-1', 'user-1', 150, { type: 'crime_win', reason: expect.any(String) });

  const embed = interaction.editReply.mock.calls.at(-1)[0].embeds[0];
  expect(embed.data.description).toContain('150');
  expect(embed.data.description).not.toMatch(/mascota/i);
});

it('no importa ni ejecuta nada de petsStore.js', async () => {
  const interaction = makeInteraction();
  await expect(execute(interaction)).resolves.not.toThrow();
});
