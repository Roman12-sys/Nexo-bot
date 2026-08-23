import { vi, describe, it, expect, beforeEach } from 'vitest';

// Nuevo (roadmap "auditoría de cambios de configuración"): /config ahora deja un
// rastro en el canal de logs de actividad cada vez que toca guild_config — antes,
// a diferencia de los cambios NATIVOS de Discord (roles, canales, que sí quedan
// logueados por los 32 listeners), un admin pisando /config rol-castigo no dejaba
// ninguna huella.
const getGuildConfig = vi.fn();
const setGuildConfig = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig, setGuildConfig }));

const getGuildLogChannel = vi.fn();
vi.mock('../src/utils/guildLogChannels.js', () => ({ getGuildLogChannel }));

const { execute } = await import('../src/commands/admin/config.js');

function makeInteraction({ subcommand, role = null, channel = null }) {
  return {
    guild: { ownerId: 'user-1' },
    member: { permissions: { has: () => true } },
    user: { id: 'user-1', tag: 'admin#0001' },
    guildId: 'guild-1',
    client: {},
    options: {
      getSubcommand: () => subcommand,
      getRole: () => role,
      getChannel: () => channel,
    },
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

const logChannel = { send: vi.fn().mockResolvedValue(undefined) };

beforeEach(() => {
  vi.clearAllMocks();
  getGuildLogChannel.mockResolvedValue(logChannel);
});

describe('/config deja rastro en el log de actividad', () => {
  it('configurar el rol de castigo loguea el cambio con quién lo hizo', async () => {
    const interaction = makeInteraction({ subcommand: 'rol-castigo', role: { id: 'role-1', toString: () => '<@&role-1>' } });

    await execute(interaction);

    expect(setGuildConfig).toHaveBeenCalledWith('guild-1', { punish_role_id: 'role-1' });
    expect(logChannel.send).toHaveBeenCalledTimes(1);
    const embed = logChannel.send.mock.calls[0][0].embeds[0];
    expect(embed.data.title).toMatch(/Nexo/);
    expect(embed.data.fields.some((f) => f.value.includes('Rol de castigo'))).toBe(true);
  });

  it('desactivar un campo (rol vacío) también se loguea, con el texto de "desactivado"', async () => {
    const interaction = makeInteraction({ subcommand: 'rol-automatico', role: null });

    await execute(interaction);

    expect(setGuildConfig).toHaveBeenCalledWith('guild-1', { auto_role_id: null });
    const embed = logChannel.send.mock.calls[0][0].embeds[0];
    expect(embed.data.fields[1].value).toMatch(/desactivado/);
  });

  it('sin canal de logs de actividad configurado, no revienta (solo no loguea)', async () => {
    getGuildLogChannel.mockResolvedValue(null);
    const interaction = makeInteraction({ subcommand: 'canal-bienvenida', channel: { id: 'chan-1', toString: () => '<#chan-1>' } });

    await expect(execute(interaction)).resolves.not.toThrow();
    expect(interaction.reply).toHaveBeenCalled();
  });

  it('/config ver NO genera un log — es solo lectura, no un cambio', async () => {
    getGuildConfig.mockResolvedValue({
      admin_role_id: null, moderator_role_id: null, punish_role_id: null, auto_role_id: null,
      welcome_channel_id: null, confession_channel_id: null, xp_announce_channel_id: null,
      log_channel_moderation_id: null, log_channel_activity_id: null, log_channel_economy_id: null,
      level_roles: {}, level_roles_mode: 'cumulative', features: {}, setup_completed_at: null,
    });
    const interaction = makeInteraction({ subcommand: 'ver' });

    await execute(interaction);

    expect(logChannel.send).not.toHaveBeenCalled();
  });

  it('/config exportar adjunta un JSON sin guild_id y tampoco genera un log (solo lectura)', async () => {
    getGuildConfig.mockResolvedValue({ guild_id: 'guild-1', admin_role_id: 'role-admin', punish_role_id: null });
    const interaction = makeInteraction({ subcommand: 'exportar' });

    await execute(interaction);

    expect(logChannel.send).not.toHaveBeenCalled();
    const payload = interaction.reply.mock.calls[0][0];
    const attachment = payload.files[0];
    const json = JSON.parse(attachment.attachment.toString('utf-8'));
    expect(json.admin_role_id).toBe('role-admin');
    expect(json.guild_id).toBeUndefined();
  });
});
