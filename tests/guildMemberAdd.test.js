import { vi, describe, it, expect, beforeEach } from 'vitest';

// guildMemberAdd.js — CICLO 1, Mejora 2/2: el mensaje de bienvenida ahora incluye texto
// guiando a /help y, si el server configuró roles autoasignables, el select menu de
// src/utils/selfRoles.js — reusando el MISMO mensaje de siempre (nunca un segundo
// mensaje aparte, nunca una mención extra del usuario).
const getGuildConfig = vi.fn();
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig }));

const getGuildLogChannel = vi.fn().mockResolvedValue(null);
vi.mock('../src/utils/guildLogChannels.js', () => ({ getGuildLogChannel }));

const findExecutor = vi.fn().mockResolvedValue(null);
vi.mock('../src/utils/auditLog.js', () => ({ findExecutor }));

const createBotAddedLogEmbed = vi.fn().mockReturnValue({});
const createPunishLogEmbed = vi.fn().mockReturnValue({});
vi.mock('../src/utils/logEmbeds.js', () => ({ createBotAddedLogEmbed, createPunishLogEmbed }));

const getActivePunishment = vi.fn();
vi.mock('../src/utils/punishStore.js', () => ({ getActivePunishment }));

const recordModerationAction = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/moderationActionsStore.js', () => ({ recordModerationAction }));

const buildWelcomeImageAttachment = vi.fn().mockResolvedValue({ name: 'welcome.png' });
vi.mock('../src/utils/welcomeImage.js', () => ({ buildWelcomeImageAttachment }));

const buildSelfRolesMessage = vi.fn().mockResolvedValue(null);
vi.mock('../src/utils/selfRoles.js', () => ({ buildSelfRolesMessage }));

const checkMemberCountAchievements = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/guildAchievements.js', () => ({ checkMemberCountAchievements }));

const emit = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/eventBus.js', () => ({ eventBus: { emit } }));

const { execute } = await import('../src/events/guildMemberAdd.js');

function makeMember({ userId = 'user-1', isBot = false, channelFetchResult = undefined } = {}) {
  const channel = channelFetchResult === undefined
    ? { isTextBased: () => true, send: vi.fn().mockResolvedValue(undefined) }
    : channelFetchResult;

  return {
    id: userId,
    user: { id: userId, bot: isBot, tag: `user-${userId}#0001` },
    toString: () => `<@${userId}>`,
    guild: {
      id: 'guild-1',
      name: 'Server de prueba',
      memberCount: 42,
      roles: { cache: new Map(), fetch: vi.fn().mockResolvedValue(null) },
      members: { fetchMe: vi.fn().mockResolvedValue({ permissions: { has: () => true }, roles: { highest: { position: 100 } } }) },
      channels: { fetch: vi.fn().mockResolvedValue(channel === null ? null : channel) },
    },
    roles: { add: vi.fn().mockResolvedValue(undefined) },
    _channel: channel,
  };
}

const client = { user: { id: 'bot-1' } };

beforeEach(() => {
  vi.clearAllMocks();
  getGuildConfig.mockResolvedValue({ auto_role_id: null, welcome_channel_id: null });
  getGuildLogChannel.mockResolvedValue(null);
  buildSelfRolesMessage.mockResolvedValue(null);
  getActivePunishment.mockResolvedValue(null);
});

// MOD-2 (auditoría completa 2026-09-11): /punish se evadía por completo saliendo y
// reentrando al servidor — Discord quita todos los roles al salir, y nada volvía a
// aplicar la restricción. Ahora active_punishments guarda siempre una fila (incluso
// las indefinidas, expiresAt null) y guildMemberAdd.js la reaplica acá.
describe('guildMemberAdd — reaplicación de /punish al reingresar (MOD-2)', () => {
  it('sin restricción activa: no toca roles ni loguea nada', async () => {
    getActivePunishment.mockResolvedValue(null);
    const member = makeMember();
    member.guild.roles.cache.set('role-sancionado', { id: 'role-sancionado' });

    await execute(member, client);

    expect(member.roles.add).not.toHaveBeenCalled();
    expect(recordModerationAction).not.toHaveBeenCalled();
  });

  it('restricción indefinida (expiresAt null): reaplica el rol y lo audita', async () => {
    getActivePunishment.mockResolvedValue({ guildId: 'guild-1', userId: 'user-1', roleId: 'role-sancionado', expiresAt: null });
    getGuildLogChannel.mockResolvedValue({ send: vi.fn().mockResolvedValue(undefined) });
    const member = makeMember();
    member.guild.roles.cache.set('role-sancionado', { id: 'role-sancionado' });

    await execute(member, client);

    expect(member.roles.add).toHaveBeenCalledWith('role-sancionado', expect.stringContaining('reingres'));
    expect(recordModerationAction).toHaveBeenCalledWith('guild-1', 'user-1', expect.objectContaining({ actionType: 'punish_reapply' }));
  });

  it('restricción con duración todavía vigente: se reaplica igual', async () => {
    getActivePunishment.mockResolvedValue({ guildId: 'guild-1', userId: 'user-1', roleId: 'role-sancionado', expiresAt: Date.now() + 60_000 });
    const member = makeMember();
    member.guild.roles.cache.set('role-sancionado', { id: 'role-sancionado' });

    await execute(member, client);

    expect(member.roles.add).toHaveBeenCalledWith('role-sancionado', expect.any(String));
  });

  it('restricción con duración ya vencida (timer todavía no disparó): NO se reaplica', async () => {
    getActivePunishment.mockResolvedValue({ guildId: 'guild-1', userId: 'user-1', roleId: 'role-sancionado', expiresAt: Date.now() - 1_000 });
    const member = makeMember();
    member.guild.roles.cache.set('role-sancionado', { id: 'role-sancionado' });

    await execute(member, client);

    expect(member.roles.add).not.toHaveBeenCalled();
  });

  it('el rol ya no existe en el servidor: no revienta, no llama roles.add', async () => {
    getActivePunishment.mockResolvedValue({ guildId: 'guild-1', userId: 'user-1', roleId: 'role-borrado', expiresAt: null });
    const member = makeMember(); // guild.roles.cache vacío — el rol no existe

    await expect(execute(member, client)).resolves.not.toThrow();
    expect(member.roles.add).not.toHaveBeenCalled();
  });

  it('un fallo al reaplicar (permiso insuficiente) nunca corta el resto del flujo de bienvenida', async () => {
    getActivePunishment.mockResolvedValue({ guildId: 'guild-1', userId: 'user-1', roleId: 'role-sancionado', expiresAt: null });
    getGuildConfig.mockResolvedValue({ welcome_channel_id: 'chan-bienvenida' });
    const member = makeMember();
    member.guild.roles.cache.set('role-sancionado', { id: 'role-sancionado' });
    member.roles.add = vi.fn().mockRejectedValue(new Error('Missing Permissions'));

    await expect(execute(member, client)).resolves.not.toThrow();
    expect(member._channel.send).toHaveBeenCalledTimes(1); // la bienvenida se manda igual
  });
});

describe('guildMemberAdd — bots', () => {
  it('un bot agregado nunca recibe el embed de bienvenida ni el menú de roles', async () => {
    const member = makeMember({ isBot: true });
    getGuildConfig.mockResolvedValue({ welcome_channel_id: 'chan-bienvenida' });

    await execute(member, client);

    expect(buildSelfRolesMessage).not.toHaveBeenCalled();
    expect(member.guild.channels.fetch).not.toHaveBeenCalled();
  });
});

describe('guildMemberAdd — sin canal de bienvenida configurado', () => {
  it('no manda nada y no arma el menú de roles (aunque haya roles autoasignables)', async () => {
    getGuildConfig.mockResolvedValue({ welcome_channel_id: null });
    const member = makeMember();

    await execute(member, client);

    expect(member.guild.channels.fetch).not.toHaveBeenCalled();
    expect(buildSelfRolesMessage).not.toHaveBeenCalled();
  });
});

describe('guildMemberAdd — con canal de bienvenida configurado', () => {
  it('sin roles autoasignables: el mensaje se manda igual que siempre, sin componentes', async () => {
    getGuildConfig.mockResolvedValue({ welcome_channel_id: 'chan-bienvenida' });
    buildSelfRolesMessage.mockResolvedValue(null);
    const member = makeMember();

    await execute(member, client);

    expect(member._channel.send).toHaveBeenCalledTimes(1);
    const payload = member._channel.send.mock.calls[0][0];
    expect(payload.components).toEqual([]);
    expect(payload.content).toBe('<@user-1>'); // una sola mención, la de siempre
    const embed = payload.embeds[0];
    expect(embed.data.fields).toBeUndefined(); // sin campo de roles si no hay nada que ofrecer
  });

  it('con roles autoasignables: agrega el select menu Y el campo que lo explica, en el MISMO mensaje', async () => {
    getGuildConfig.mockResolvedValue({ welcome_channel_id: 'chan-bienvenida' });
    const fakeRow = { type: 1 };
    buildSelfRolesMessage.mockResolvedValue({ content: '🎭 Elegí tus roles', components: [fakeRow] });
    const member = makeMember();

    await execute(member, client);

    expect(member._channel.send).toHaveBeenCalledTimes(1); // sigue siendo UN solo mensaje
    const payload = member._channel.send.mock.calls[0][0];
    expect(payload.components).toEqual([fakeRow]);
    const embed = payload.embeds[0];
    expect(embed.data.fields.find((f) => f.name.includes('rol'))?.value).toBe('🎭 Elegí tus roles');
    // Solo UNA mención del usuario (en `content`) — el campo de roles no vuelve a mencionarlo.
    expect(payload.content).toBe('<@user-1>');
  });

  // Ciclo 1, Bloque 9 — guildMemberAdd.js ya resuelve `cfg` para auto_role_id/
  // welcome_channel_id; se lo pasa a buildSelfRolesMessage en vez de dejar que lo
  // vuelva a pedir por su cuenta.
  it('le pasa el cfg ya resuelto a buildSelfRolesMessage (no lo hace pedir de nuevo)', async () => {
    const cfg = { welcome_channel_id: 'chan-bienvenida', auto_role_id: null, selfassignable_roles: ['role-1'] };
    getGuildConfig.mockResolvedValue(cfg);
    const member = makeMember();

    await execute(member, client);

    expect(buildSelfRolesMessage).toHaveBeenCalledWith(member.guild, member, cfg);
  });

  it('siempre menciona /help en la descripción del embed (COM/descubrimiento)', async () => {
    getGuildConfig.mockResolvedValue({ welcome_channel_id: 'chan-bienvenida' });
    const member = makeMember();

    await execute(member, client);

    const embed = member._channel.send.mock.calls[0][0].embeds[0];
    expect(embed.data.description).toContain('/help');
  });

  it('canal de bienvenida borrado/inaccesible: no revienta, no arma el menú de roles en vano', async () => {
    getGuildConfig.mockResolvedValue({ welcome_channel_id: 'chan-borrado' });
    const member = makeMember({ channelFetchResult: null });

    await expect(execute(member, client)).resolves.not.toThrow();
    expect(buildSelfRolesMessage).not.toHaveBeenCalled();
  });
});
