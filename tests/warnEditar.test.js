import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeInteraction, makeTargetMember } from './helpers/discordMock.js';

// /warn-editar — Fase 2B, sección 1C: antes era el único comando de moderación sin
// ningún chequeo de jerarquía (getModerationBlockReason). No se mockea permissions.js —
// misma integración real que moderation.test.js.
const getGuildConfig = vi.fn();
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig }));

const getUserWarns = vi.fn().mockResolvedValue([]);
const updateWarnReasonAt = vi.fn();
vi.mock('../src/utils/warnsStore.js', () => ({ getUserWarns, updateWarnReasonAt }));

const getGuildLogChannel = vi.fn().mockResolvedValue(null);
vi.mock('../src/utils/guildLogChannels.js', () => ({ getGuildLogChannel }));

const { execute: warnEditarExecute } = await import('../src/commands/moderacion/warnEditar.js');

const STAFF_CFG = { admin_role_id: 'role-admin', moderator_role_id: null };
const NO_STAFF_CFG = { admin_role_id: null, moderator_role_id: null };

beforeEach(() => {
  vi.clearAllMocks();
  getGuildConfig.mockResolvedValue(STAFF_CFG);
  getGuildLogChannel.mockResolvedValue(null);
});

describe('/warn-editar', () => {
  it('sin permisos: no llama a updateWarnReasonAt', async () => {
    getGuildConfig.mockResolvedValue(NO_STAFF_CFG);
    const interaction = makeInteraction({ staffRoleIds: [], options: { numero: 1, motivo: 'corregido' } });

    await warnEditarExecute(interaction);

    expect(updateWarnReasonAt).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('permisos') }));
  });

  it('target de rango igual/superior (no owner): rechazado por jerarquía, no edita nada', async () => {
    const interaction = makeInteraction({
      staffRoleIds: ['role-admin'],
      userPosition: 5,
      targetMember: makeTargetMember({ position: 5 }),
      options: { numero: 1, motivo: 'corregido' },
    });

    await warnEditarExecute(interaction);

    expect(updateWarnReasonAt).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('rango') }));
  });

  it('target de rango inferior: permitido, corrige el motivo', async () => {
    updateWarnReasonAt.mockResolvedValue(true);
    const interaction = makeInteraction({
      staffRoleIds: ['role-admin'],
      userPosition: 10,
      targetMember: makeTargetMember({ position: 1 }),
      options: { numero: 2, motivo: 'motivo corregido' },
    });

    await warnEditarExecute(interaction);

    expect(updateWarnReasonAt).toHaveBeenCalledWith('guild-1', 'target-1', 2, 'motivo corregido');
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('#2') }));
  });

  it('usuario que ya no está en el server: no bloquea por jerarquía (member null), pero puede seguir corrigiendo su warn vieja', async () => {
    updateWarnReasonAt.mockResolvedValue(true);
    const interaction = makeInteraction({
      staffRoleIds: ['role-admin'],
      targetMember: null,
      options: { numero: 1, motivo: 'corregido' },
    });

    await warnEditarExecute(interaction);

    expect(updateWarnReasonAt).toHaveBeenCalledWith('guild-1', 'target-1', 1, 'corregido');
  });

  it('advertencia inexistente: mensaje claro, sin loguear', async () => {
    updateWarnReasonAt.mockResolvedValue(false);
    const interaction = makeInteraction({ staffRoleIds: ['role-admin'], options: { numero: 99, motivo: 'x' } });

    await warnEditarExecute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No se encontró') }));
    expect(getGuildLogChannel).not.toHaveBeenCalled();
  });
});
