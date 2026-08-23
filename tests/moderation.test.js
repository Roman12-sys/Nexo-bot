import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeInteraction, makeTargetMember, extractButtonCustomId, makeButtonInteraction } from './helpers/discordMock.js';

// warn/ban/kick/unwarn comparten toda su lógica de permisos y jerarquía con
// permissions.js (ya testeado aparte en permissions.test.js / isStaff.test.js) — acá se
// prueba la integración real: que CADA comando efectivamente llame esos chequeos, en el
// orden correcto, y que la acción de negocio (addWarn/ban/kick/removeWarnAt) solo se
// dispare cuando todos pasan. ban.js y unwarn.js ahora muestran una confirmación antes
// de ejecutar (Fase 1) — se simulan con el router real de botones, igual que en
// confirmations.test.js, no con un mock de esa lógica.
const getGuildConfig = vi.fn();
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig }));

const addWarn = vi.fn();
const getUserWarns = vi.fn();
const removeWarnAt = vi.fn();
const clearWarns = vi.fn();
vi.mock('../src/utils/warnsStore.js', () => ({ addWarn, getUserWarns, removeWarnAt, clearWarns }));

const getGuildLogChannel = vi.fn();
vi.mock('../src/utils/guildLogChannels.js', () => ({ getGuildLogChannel }));

const { execute: warnExecute } = await import('../src/commands/moderacion/warn.js');
const { execute: kickExecute } = await import('../src/commands/moderacion/kick.js');
const { execute: banExecute } = await import('../src/commands/moderacion/ban.js');
const { execute: unwarnExecute } = await import('../src/commands/moderacion/unwarn.js');
const { routeButton } = await import('../src/components/buttons.js');

const STAFF_CFG = { admin_role_id: 'role-admin', moderator_role_id: null };
const NO_STAFF_CFG = { admin_role_id: null, moderator_role_id: null };

const logChannel = { send: vi.fn().mockResolvedValue(undefined) };

beforeEach(() => {
  vi.clearAllMocks();
  getGuildConfig.mockResolvedValue(STAFF_CFG);
  getGuildLogChannel.mockResolvedValue(logChannel);
});

async function confirmVia(panelInteraction, label, { userId, guildId, base } = {}) {
  const call = panelInteraction.reply.mock.calls[0][0];
  const prefix = label === 'Confirmar' ? 'confirm_yes_' : 'confirm_no_';
  const customId = extractButtonCustomId(call, label);
  const buttonInteraction = makeButtonInteraction(customId, {
    userId: userId ?? panelInteraction.user.id,
    guildId: guildId ?? panelInteraction.guildId,
    base: base ?? panelInteraction,
  });
  await routeButton(buttonInteraction);
  return buttonInteraction;
}

describe('/warn', () => {
  it('sin permisos de staff: no llama a addWarn', async () => {
    getGuildConfig.mockResolvedValue(NO_STAFF_CFG);
    const interaction = makeInteraction({ staffRoleIds: [] });

    await warnExecute(interaction);

    expect(addWarn).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('permisos') }));
  });

  it('autoacción (advertirse a sí mismo) queda bloqueada por getModerationBlockReason', async () => {
    const interaction = makeInteraction({
      staffRoleIds: ['role-admin'],
      userId: 'mod-1',
      targetUser: { id: 'mod-1', tag: 'mod-1#0001' },
      targetMember: makeTargetMember({ id: 'mod-1', position: 10 }),
    });

    await warnExecute(interaction);

    expect(addWarn).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('vos mismo') }));
  });

  it('intentar advertir al bot queda bloqueado', async () => {
    const interaction = makeInteraction({
      staffRoleIds: ['role-admin'],
      botId: 'bot-1',
      targetUser: { id: 'bot-1', tag: 'bot-1#0001' },
      targetMember: makeTargetMember({ id: 'bot-1', position: 10 }),
    });

    await warnExecute(interaction);

    expect(addWarn).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('el bot') }));
  });

  it('jerarquía: no se puede advertir a alguien de rango igual o superior (no-owner)', async () => {
    const interaction = makeInteraction({
      staffRoleIds: ['role-admin'],
      userPosition: 5,
      targetMember: makeTargetMember({ position: 5 }),
    });

    await warnExecute(interaction);

    expect(addWarn).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('rango') }));
  });

  it('caso exitoso: persiste con addWarn y loguea en el canal de moderación', async () => {
    addWarn.mockResolvedValue([{ reason: 'spam', moderatorId: 'mod-1' }]);
    const interaction = makeInteraction({
      staffRoleIds: ['role-admin'],
      options: { motivo: 'spam' },
    });

    await warnExecute(interaction);

    expect(addWarn).toHaveBeenCalledWith('guild-1', 'target-1', { reason: 'spam', moderatorId: 'mod-1' });
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('advertencia #1') }));
    expect(logChannel.send).toHaveBeenCalledTimes(1);
  });
});

describe('/kick', () => {
  it('sin permisos: no llama a member.kick', async () => {
    getGuildConfig.mockResolvedValue(NO_STAFF_CFG);
    const interaction = makeInteraction({ staffRoleIds: [] });

    await kickExecute(interaction);

    expect(interaction.guild.members.fetch).not.toHaveBeenCalled();
  });

  it('usuario que ya no está en el servidor: mensaje claro, no revienta', async () => {
    const interaction = makeInteraction({ staffRoleIds: ['role-admin'], targetMember: null });

    await kickExecute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No se encontró') }));
  });

  it('el bot no puede expulsar a alguien con rango igual/superior al suyo (not kickable)', async () => {
    const interaction = makeInteraction({
      staffRoleIds: ['role-admin'],
      targetMember: makeTargetMember({ kickable: false }),
    });

    await kickExecute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No puedo expulsar') }));
  });

  it('caso exitoso: llama a member.kick con el motivo y loguea', async () => {
    const targetMember = makeTargetMember();
    targetMember.kick = vi.fn().mockResolvedValue(undefined);
    const interaction = makeInteraction({ staffRoleIds: ['role-admin'], targetMember, options: { motivo: 'toxicidad' } });

    await kickExecute(interaction);

    expect(targetMember.kick).toHaveBeenCalledWith('toxicidad');
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Se expulsó') }));
    expect(logChannel.send).toHaveBeenCalledTimes(1);
  });
});

describe('/ban (con confirmación)', () => {
  it('sin permisos: ni siquiera se muestra el panel de confirmación', async () => {
    getGuildConfig.mockResolvedValue(NO_STAFF_CFG);
    const interaction = makeInteraction({ staffRoleIds: [] });

    await banExecute(interaction);

    expect(interaction.guild.members.ban).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('permisos') }));
  });

  it('caso exitoso: reply muestra confirmación, y solo al confirmar se banea y se loguea', async () => {
    const interaction = makeInteraction({ staffRoleIds: ['role-admin'], options: { motivo: 'raid' } });

    await banExecute(interaction);

    // Todavía no pasó nada — es solo el panel.
    expect(interaction.guild.members.ban).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Confirmar acción') }));

    const buttonInteraction = await confirmVia(interaction, 'Confirmar');

    expect(interaction.guild.members.ban).toHaveBeenCalledWith('target-1', { reason: 'raid' });
    expect(buttonInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Se baneó') }));
    expect(logChannel.send).toHaveBeenCalledTimes(1);
  });

  it('revalida permisos al confirmar: si dejó de ser staff en el medio, ya no banea', async () => {
    const interaction = makeInteraction({ staffRoleIds: ['role-admin'] });
    await banExecute(interaction);

    getGuildConfig.mockResolvedValue(NO_STAFF_CFG); // el rol de staff se le sacó mientras el panel esperaba
    const buttonInteraction = await confirmVia(interaction, 'Confirmar');

    expect(interaction.guild.members.ban).not.toHaveBeenCalled();
    expect(buttonInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Ya no tenés permisos') }));
  });

  it('cancelar no banea a nadie', async () => {
    const interaction = makeInteraction({ staffRoleIds: ['role-admin'] });
    await banExecute(interaction);

    await confirmVia(interaction, 'Cancelar');

    expect(interaction.guild.members.ban).not.toHaveBeenCalled();
  });
});

describe('/unwarn (con confirmación)', () => {
  it('número de advertencia inexistente: no muestra confirmación', async () => {
    getUserWarns.mockResolvedValue([{ reason: 'a' }]); // solo hay 1, piden la #5
    const interaction = makeInteraction({ staffRoleIds: ['role-admin'], options: { numero: 5 } });

    await unwarnExecute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No se encontró') }));
  });

  it('caso exitoso (una advertencia puntual): removeWarnAt se llama recién al confirmar', async () => {
    getUserWarns.mockResolvedValue([{ reason: 'spam' }, { reason: 'flood' }]);
    removeWarnAt.mockResolvedValue({ reason: 'flood', moderatorId: 'mod-1' });
    const interaction = makeInteraction({ staffRoleIds: ['role-admin'], options: { numero: 2 } });

    await unwarnExecute(interaction);
    expect(removeWarnAt).not.toHaveBeenCalled();

    const buttonInteraction = await confirmVia(interaction, 'Confirmar');

    expect(removeWarnAt).toHaveBeenCalledWith('guild-1', 'target-1', 2);
    expect(buttonInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('#2') }));
    expect(logChannel.send).toHaveBeenCalledTimes(1);
  });

  it('caso exitoso (todas): clearWarns se llama recién al confirmar', async () => {
    clearWarns.mockResolvedValue(3);
    const interaction = makeInteraction({ staffRoleIds: ['role-admin'], options: {} });

    await unwarnExecute(interaction);
    await confirmVia(interaction, 'Confirmar');

    expect(clearWarns).toHaveBeenCalledWith('guild-1', 'target-1');
    expect(logChannel.send).toHaveBeenCalledTimes(1);
  });
});
