import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeInteraction, extractButtonCustomId, makeButtonInteraction } from './helpers/discordMock.js';

// Auditoría completa NEXO (2026-09-11), XP-1: /prestigio no tenía ningún lock, y
// apply_prestige (RPC) no valida el nivel mínimo del lado de Postgres — es la única
// invariante de negocio del proyecto sin ningún respaldo atómico. Dos confirmaciones
// concurrentes (dos paneles distintos, cada uno con su propio token) podían leer el
// mismo nivel ≥50 antes de que ninguna terminara de escribir, duplicando el prestige.
// Reproducido acá con el lock real de asyncLock.js (nunca mockeado) y un mock CON
// ESTADO de xpStore, mismo patrón que giveawayEngine.test.js/casinoHelpers.test.js.

let state;
const getUserXp = vi.fn(async () => ({ ...state }));
const applyPrestige = vi.fn(async () => {
  state = { level: 0, prestige: state.prestige + 1 };
  return state.prestige;
});
vi.mock('../src/utils/xpStore.js', () => ({
  getUserXp: (...a) => getUserXp(...a),
  applyPrestige: (...a) => applyPrestige(...a),
}));

const { execute, PRESTIGE_MIN_LEVEL } = await import('../src/commands/xp/prestigio.js');
const { routeButton } = await import('../src/components/buttons.js');

async function openPanel(overrides = {}) {
  const interaction = makeInteraction(overrides);
  await execute(interaction);
  return interaction;
}

async function clickConfirm(panelInteraction) {
  const call = panelInteraction.reply.mock.calls[0][0];
  const customId = extractButtonCustomId(call, 'Confirmar');
  const buttonInteraction = makeButtonInteraction(customId, {
    userId: panelInteraction.user.id,
    guildId: panelInteraction.guildId,
    base: panelInteraction,
  });
  await routeButton(buttonInteraction);
  return buttonInteraction;
}

beforeEach(() => {
  vi.clearAllMocks();
  state = { level: PRESTIGE_MIN_LEVEL, prestige: 0 };
});

describe('/prestigio — XP-1: sin duplicar bajo confirmaciones concurrentes', () => {
  it('dos paneles distintos confirmados casi al mismo tiempo: prestige sube UNA sola vez, no dos', async () => {
    const panelA = await openPanel({ userId: 'user-1', guildId: 'guild-1' });
    const panelB = await openPanel({ userId: 'user-1', guildId: 'guild-1' });

    const [buttonA, buttonB] = await Promise.all([clickConfirm(panelA), clickConfirm(panelB)]);

    expect(applyPrestige).toHaveBeenCalledTimes(1);
    expect(state.prestige).toBe(1);

    const contents = [buttonA.editReply.mock.calls[0][0].content, buttonB.editReply.mock.calls[0][0].content];
    expect(contents.filter((c) => c.includes('¡Prestigiaste!'))).toHaveLength(1);
    expect(contents.filter((c) => c.includes('Ya no cumplís el nivel mínimo'))).toHaveLength(1);
  });

  it('secuencial (sin carrera): sigue funcionando exactamente igual que antes', async () => {
    const panel = await openPanel({ userId: 'user-2', guildId: 'guild-2' });
    const button = await clickConfirm(panel);

    expect(applyPrestige).toHaveBeenCalledTimes(1);
    expect(button.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('¡Prestigiaste!') }));
  });
});
