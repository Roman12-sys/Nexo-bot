import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeInteraction, makeSelectInteraction } from './helpers/discordMock.js';

// Panel /sanciones — Fase 2B, sección 1A (jerarquía en el select de borrar warns),
// sección 1B (revokePunishment real en el select de quitar restricción) y sección 4
// (el historial ahora muestra extra.until de un timeout). No se mockea permissions.js:
// se usa isStaff/getModerationBlockReason reales (como moderation.test.js), así se
// prueba la integración real, no una versión simulada de la política de jerarquía.
const getGuildConfig = vi.fn();
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig }));

const getGuildLogChannel = vi.fn().mockResolvedValue(null);
vi.mock('../src/utils/guildLogChannels.js', () => ({ getGuildLogChannel }));

const getGuildWarns = vi.fn();
const clearWarns = vi.fn();
vi.mock('../src/utils/warnsStore.js', () => ({ getGuildWarns, clearWarns }));

const getActiveTimeouts = vi.fn();
const getPunishedMembers = vi.fn();
const getBannedUsers = vi.fn();
vi.mock('../src/utils/sanctions.js', () => ({ getActiveTimeouts, getPunishedMembers, getBannedUsers }));

const recordModerationAction = vi.fn().mockResolvedValue(undefined);
const getUserModerationActions = vi.fn().mockResolvedValue([]);
vi.mock('../src/utils/moderationActionsStore.js', () => ({ recordModerationAction, getUserModerationActions }));

// punishEngine.js SIN mockear (salvo su propia dependencia de datos, punishStore.js) —
// para la sección 1B lo que importa probar es que el select realmente cancela un timer
// programado de verdad, no solo que "se llamó a una función".
const createActivePunishment = vi.fn().mockResolvedValue(undefined);
const getActivePunishment = vi.fn();
const getAllActivePunishments = vi.fn().mockResolvedValue([]);
const deleteActivePunishment = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/punishStore.js', () => ({
  createActivePunishment,
  getActivePunishment,
  getAllActivePunishments,
  deleteActivePunishment,
}));

const { execute: sancionesExecute } = await import('../src/commands/moderacion/sanciones.js');
const { routeSelect } = await import('../src/components/selects.js');
const { schedulePunishExpiry } = await import('../src/utils/punishEngine.js');

const STAFF_CFG = { admin_role_id: 'role-admin', moderator_role_id: null, punish_role_id: 'role-sancionado' };

beforeEach(() => {
  vi.clearAllMocks();
  getGuildConfig.mockResolvedValue(STAFF_CFG);
  getGuildLogChannel.mockResolvedValue(null);
  getUserModerationActions.mockResolvedValue([]);
  deleteActivePunishment.mockResolvedValue(undefined);
});

// buildHistorialEmbed llama targetUser.displayAvatarURL() (miniatura del embed) — un
// User real de discord.js lo tiene, el targetUser plano de otros tests de este archivo
// no lo necesita porque no pasa por acá.
function makeHistorialTargetUser() {
  return { id: 'target-1', tag: 'target-1#0001', displayAvatarURL: () => 'https://example.com/avatar.png' };
}

describe('/sanciones <usuario> — historial (sección 4: duración de timeout)', () => {
  it('una acción timeout con extra.until muestra la fecha de finalización', async () => {
    const until = Date.now() + 3600_000;
    getUserModerationActions.mockResolvedValue([
      { actionType: 'timeout', moderatorId: 'mod-1', reason: 'flood', extra: { until }, timestamp: Date.now() },
    ]);
    const interaction = makeInteraction({ staffRoleIds: ['role-admin'], targetUser: makeHistorialTargetUser() });

    await sancionesExecute(interaction);

    const embed = interaction.editReply.mock.calls[0][0].embeds[0];
    expect(embed.data.fields[0].value).toContain('Hasta:');
    expect(embed.data.fields[0].value).toContain(`<t:${Math.floor(until / 1000)}:f>`);
  });

  it('una acción sin extra (ban/kick/etc) sigue funcionando, sin línea de "Hasta"', async () => {
    getUserModerationActions.mockResolvedValue([{ actionType: 'ban', moderatorId: 'mod-1', reason: 'raid', extra: {}, timestamp: Date.now() }]);
    const interaction = makeInteraction({ staffRoleIds: ['role-admin'], targetUser: makeHistorialTargetUser() });

    await sancionesExecute(interaction);

    const embed = interaction.editReply.mock.calls[0][0].embeds[0];
    expect(embed.data.fields[0].value).not.toContain('Hasta:');
  });

  it('un timeout SIN extra.until (fila vieja) no revienta y no muestra "Hasta"', async () => {
    getUserModerationActions.mockResolvedValue([{ actionType: 'timeout', moderatorId: 'mod-1', reason: null, extra: {}, timestamp: Date.now() }]);
    const interaction = makeInteraction({ staffRoleIds: ['role-admin'], targetUser: makeHistorialTargetUser() });

    await expect(sancionesExecute(interaction)).resolves.toBeUndefined();
    const embed = interaction.editReply.mock.calls[0][0].embeds[0];
    expect(embed.data.fields[0].value).not.toContain('Hasta:');
  });
});

describe('panel /sanciones — select de borrar advertencias (sección 1A: jerarquía)', () => {
  function member({ position = 1 } = {}) {
    return { id: 'target-1', roles: { highest: { position } } };
  }

  it('sin permisos de staff: rechazado, no borra nada', async () => {
    const interaction = makeSelectInteraction({ staffRoleIds: [], values: ['target-1'], member: member() });

    await routeSelect({ ...interaction, customId: 'sanciones_select_warn' });

    expect(clearWarns).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('permisos') }));
  });

  it('target de rango inferior: permitido, borra las advertencias', async () => {
    clearWarns.mockResolvedValue(3);
    const interaction = makeSelectInteraction({
      staffRoleIds: ['role-admin'],
      userPosition: 10,
      values: ['target-1'],
      member: member({ position: 1 }),
    });

    await routeSelect({ ...interaction, customId: 'sanciones_select_warn' });

    expect(clearWarns).toHaveBeenCalledWith('guild-1', 'target-1');
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('3 advertencia') }));
  });

  it('target de rango igual/superior (no owner): rechazado por jerarquía, no borra nada', async () => {
    const interaction = makeSelectInteraction({
      staffRoleIds: ['role-admin'],
      userPosition: 5,
      ownerId: 'someone-else',
      values: ['target-1'],
      member: member({ position: 5 }),
    });

    await routeSelect({ ...interaction, customId: 'sanciones_select_warn' });

    expect(clearWarns).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('rango') }));
  });

  it('operación normal: además de borrar, anuncia en el canal y loguea', async () => {
    clearWarns.mockResolvedValue(1);
    const interaction = makeSelectInteraction({ staffRoleIds: ['role-admin'], values: ['target-1'], member: member({ position: 1 }) });
    getGuildLogChannel.mockResolvedValue({ send: vi.fn().mockResolvedValue(undefined) });

    await routeSelect({ ...interaction, customId: 'sanciones_select_warn' });

    expect(interaction.channel.send).toHaveBeenCalledTimes(1);
    expect(getGuildLogChannel).toHaveBeenCalledWith(interaction.client, 'guild-1', 'moderation');
  });
});

describe('panel /sanciones — select de quitar restricción (sección 1B: equivalente a /unpunish)', () => {
  function punishMember({ position = 1 } = {}) {
    return {
      id: 'target-1',
      user: { id: 'target-1', tag: 'target-1#0001' },
      roles: { highest: { position }, remove: vi.fn().mockResolvedValue(undefined), cache: { has: () => true } },
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('quitar una restricción CON duración desde el panel cancela el timer y borra la fila — no expira después', async () => {
    const member = punishMember();
    const fakeClient = { user: { id: 'bot-1' }, guilds: { fetch: vi.fn() }, users: { fetch: vi.fn() } };

    // Arma un timer real de duración, como haría /punish con `duracion:1h`.
    const expiresAt = Date.now() + 60 * 60 * 1000;
    schedulePunishExpiry(fakeClient, { guildId: 'guild-1', userId: 'target-1', roleId: 'role-sancionado', expiresAt });

    const interaction = makeSelectInteraction({ staffRoleIds: ['role-admin'], values: ['target-1'], member });
    await routeSelect({ ...interaction, customId: 'sanciones_select_punish' });

    // El select ya debería haber quitado el rol y limpiado el estado persistido.
    expect(member.roles.remove).toHaveBeenCalledWith('role-sancionado');
    expect(deleteActivePunishment).toHaveBeenCalledWith('guild-1', 'target-1');
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('quitó la restricción') }));

    // Ahora, si el timer viejo NO hubiera sido cancelado de verdad, llegar a la hora
    // original dispararía una segunda "expiración automática" fantasma.
    deleteActivePunishment.mockClear();
    member.roles.remove.mockClear();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(deleteActivePunishment).not.toHaveBeenCalled();
    expect(member.roles.remove).not.toHaveBeenCalled();
  });

  it('target de rango igual/superior: rechazado por jerarquía, no toca el rol', async () => {
    const member = punishMember({ position: 10 });
    const interaction = makeSelectInteraction({ staffRoleIds: ['role-admin'], userPosition: 10, ownerId: 'someone-else', values: ['target-1'], member });

    await routeSelect({ ...interaction, customId: 'sanciones_select_punish' });

    expect(member.roles.remove).not.toHaveBeenCalled();
    expect(deleteActivePunishment).not.toHaveBeenCalled();
  });
});
