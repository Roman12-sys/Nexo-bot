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

// Auditoría Ciclo 1 (hallazgo Bajo) — la multa se calcula contra un balance leído un
// momento antes de deductBalanceIfSufficient, sin ningún try/catch: si otro comando
// (/buy, /vender, /give) vacía el balance en esa ventana angosta, el error
// insufficient_funds salía sin manejar hacia el catch-all genérico de
// interactionCreate.js en vez de un mensaje de negocio. No se tocó el cálculo de la
// multa, la economía, el lock ni la RPC — solo se agregó el manejo del error esperado.
describe('golpe fallido — multa (auditoría Ciclo 1, hallazgo Bajo)', () => {
  beforeEach(() => {
    // Fuerza la rama de FALLO: Math.random() = 0.9 → exito = (0.9 < SUCCESS_CHANCE 0.6) = false.
    // fine = floor(0.9 * 101) + 50 = 140 (determinístico, mismo valor mockeado para todo).
    Math.random.mockReturnValue(0.9);
    getUserEconomy.mockResolvedValue({ lastCrime: 0, balance: 1000 });
  });

  it('multa aplicada normalmente: descuenta y registra la transacción (sin regresión)', async () => {
    deductBalanceIfSufficient.mockResolvedValue(860);
    const interaction = makeInteraction();

    await execute(interaction);

    expect(deductBalanceIfSufficient).toHaveBeenCalledWith('guild-1', 'user-1', 140);
    expect(recordTransaction).toHaveBeenCalledWith('guild-1', 'user-1', expect.objectContaining({ type: 'crime_fine', amount: -140 }));
    const embed = interaction.editReply.mock.calls.at(-1)[0].embeds[0];
    expect(embed.data.description).toContain('Perdiste **140**');
  });

  it('insufficient_funds (carrera con otro comando): se trata como "nada que perder", nunca revienta ni deja saldo negativo', async () => {
    deductBalanceIfSufficient.mockRejectedValue(Object.assign(new Error('insufficient_funds'), { code: 'insufficient_funds' }));
    const interaction = makeInteraction();

    await expect(execute(interaction)).resolves.not.toThrow();

    expect(recordTransaction).not.toHaveBeenCalled();
    // pre-check + lectura dentro del lock + currentEconomy + relectura de fallback tras el catch
    expect(getUserEconomy).toHaveBeenCalledTimes(4);
    const embed = interaction.editReply.mock.calls.at(-1)[0].embeds[0];
    expect(embed.data.description).toContain('no tenías nada que perder');
  });

  it('error inesperado (no insufficient_funds): se propaga sin manejar acá, no se registra ninguna transacción', async () => {
    deductBalanceIfSufficient.mockRejectedValue(new Error('network blip'));
    const interaction = makeInteraction();

    await expect(execute(interaction)).rejects.toThrow('network blip');
    expect(recordTransaction).not.toHaveBeenCalled();
  });
});
