import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeInteraction, makeTargetMember } from './helpers/discordMock.js';

// /unpunish — Fase 2B, sección 3 (defer antes de la operación lenta) — revokePunishment
// en sí (cancela timer/borra fila/quita rol) ya tiene su propia batería en
// punishEngine.test.js; acá lo que importa es que /unpunish la llame con los argumentos
// correctos y en el momento correcto del lifecycle de la interacción.
const getGuildConfig = vi.fn();
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig }));

const getGuildLogChannel = vi.fn().mockResolvedValue(null);
vi.mock('../src/utils/guildLogChannels.js', () => ({ getGuildLogChannel }));

const revokePunishment = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/punishEngine.js', () => ({ revokePunishment }));

const { execute: unpunishExecute } = await import('../src/commands/moderacion/unpunish.js');

const STAFF_CFG = { admin_role_id: 'role-admin', moderator_role_id: null, punish_role_id: 'role-sancionado' };
const NO_STAFF_CFG = { admin_role_id: null, moderator_role_id: null };

function punishedMember({ position = 1, hasRole = true } = {}) {
  return {
    ...makeTargetMember({ position }),
    roles: { highest: { position }, cache: { has: () => hasRole } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getGuildConfig.mockResolvedValue(STAFF_CFG);
  getGuildLogChannel.mockResolvedValue(null);
});

describe('/unpunish', () => {
  it('sin permisos: no llama a revokePunishment', async () => {
    getGuildConfig.mockResolvedValue(NO_STAFF_CFG);
    const interaction = makeInteraction({ staffRoleIds: [] });

    await unpunishExecute(interaction);

    expect(revokePunishment).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('permisos') }));
  });

  it('sin rol de castigo configurado: mensaje claro, no llama a revokePunishment', async () => {
    getGuildConfig.mockResolvedValue({ admin_role_id: 'role-admin', moderator_role_id: null, punish_role_id: null });
    const interaction = makeInteraction({ staffRoleIds: ['role-admin'] });

    await unpunishExecute(interaction);

    expect(interaction.deferReply).toHaveBeenCalledTimes(1);
    expect(revokePunishment).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('rol-castigo') }));
  });

  it('usuario que ya no está en el servidor: mensaje claro, no revienta', async () => {
    const interaction = makeInteraction({ staffRoleIds: ['role-admin'], targetMember: null });

    await unpunishExecute(interaction);

    expect(revokePunishment).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No se encontró') }));
  });

  it('jerarquía: target de rango igual/superior queda bloqueado', async () => {
    const interaction = makeInteraction({
      staffRoleIds: ['role-admin'],
      userPosition: 5,
      targetMember: punishedMember({ position: 5 }),
    });

    await unpunishExecute(interaction);

    expect(revokePunishment).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('rango') }));
  });

  it('el usuario no tiene la restricción aplicada: mensaje claro, no llama a revokePunishment', async () => {
    const interaction = makeInteraction({ staffRoleIds: ['role-admin'], targetMember: punishedMember({ hasRole: false }) });

    await unpunishExecute(interaction);

    expect(revokePunishment).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('no tiene la restricción') }));
  });

  it('caso exitoso: llama a revokePunishment con guildId/userId/roleId/member y loguea', async () => {
    const targetMember = punishedMember();
    const interaction = makeInteraction({ staffRoleIds: ['role-admin'], targetMember });
    getGuildLogChannel.mockResolvedValue({ send: vi.fn().mockResolvedValue(undefined) });

    await unpunishExecute(interaction);

    expect(revokePunishment).toHaveBeenCalledWith(interaction.client, {
      guildId: 'guild-1',
      userId: 'target-1',
      roleId: 'role-sancionado',
      member: targetMember,
    });
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Se le quitó la restricción') }));
  });

  it('si revokePunishment falla, responde con error en vez de reventar o responder dos veces', async () => {
    revokePunishment.mockRejectedValueOnce(new Error('discord caído'));
    const interaction = makeInteraction({ staffRoleIds: ['role-admin'], targetMember: punishedMember() });

    await expect(unpunishExecute(interaction)).resolves.toBeUndefined();

    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('error') }));
    expect(interaction.reply).not.toHaveBeenCalled(); // ya se había deferido — nunca un reply() después de eso
  });
});
