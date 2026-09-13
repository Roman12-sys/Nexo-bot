import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeInteraction } from './helpers/discordMock.js';

// /unwarn no tenía ningún archivo de test propio antes de la auditoría 2026-09-12.
// Este archivo cubre puntualmente el hallazgo de esa auditoría (autocomplete sin gate
// de isStaff()) — no busca ser cobertura completa del comando.
const getGuildConfig = vi.fn();
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig }));

const getUserWarns = vi.fn().mockResolvedValue([{ id: 'w1', reason: 'motivo sensible real' }]);
vi.mock('../src/utils/warnsStore.js', () => ({
  getUserWarns,
  removeWarnAt: vi.fn(),
  clearWarns: vi.fn(),
}));

const { autocomplete } = await import('../src/commands/moderacion/unwarn.js');

const STAFF_CFG = { admin_role_id: 'role-admin', moderator_role_id: null };
const NO_STAFF_CFG = { admin_role_id: null, moderator_role_id: null };

beforeEach(() => {
  vi.clearAllMocks();
  getUserWarns.mockResolvedValue([{ id: 'w1', reason: 'motivo sensible real' }]);
});

describe('/unwarn autocomplete — gate de isStaff() (auditoría 2026-09-12)', () => {
  it('sin isStaff() responde [] sin exponer los motivos reales', async () => {
    getGuildConfig.mockResolvedValue(NO_STAFF_CFG);
    const interaction = makeInteraction({ staffRoleIds: [], options: { numero: null } });
    interaction.respond = vi.fn().mockResolvedValue(undefined);

    await autocomplete(interaction);

    expect(getUserWarns).not.toHaveBeenCalled();
    expect(interaction.respond).toHaveBeenCalledWith([]);
  });

  it('con isStaff() real responde con los motivos', async () => {
    getGuildConfig.mockResolvedValue(STAFF_CFG);
    const interaction = makeInteraction({ staffRoleIds: ['role-admin'], options: { numero: null } });
    interaction.respond = vi.fn().mockResolvedValue(undefined);

    await autocomplete(interaction);

    expect(getUserWarns).toHaveBeenCalled();
    expect(interaction.respond).toHaveBeenCalledWith([expect.objectContaining({ name: expect.stringContaining('motivo sensible real') })]);
  });
});
