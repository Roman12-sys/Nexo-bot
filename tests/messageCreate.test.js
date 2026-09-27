import { vi, describe, it, expect, beforeEach } from 'vitest';

// messageCreate.js es el camino que más corre en todo el bot (cada mensaje de cada
// servidor) y hasta el 2026-09-27 no tenía ni un test directo. Lo que se prueba acá es el
// orden y las condiciones de cada parte — detección de claves, AFK, anti-spam, XP y
// filtro de sancionados — no la lógica interna de cada detector (ya cubierta en
// secretDetector/spamDetector/xpStore/xpEngineLogic.test.js).
const getGuildConfig = vi.fn();
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig: (...a) => getGuildConfig(...a) }));

const getGuildLogChannel = vi.fn();
vi.mock('../src/utils/guildLogChannels.js', () => ({ getGuildLogChannel: (...a) => getGuildLogChannel(...a) }));

const grantMessageXp = vi.fn();
vi.mock('../src/utils/xpStore.js', () => ({ grantMessageXp: (...a) => grantMessageXp(...a) }));

const processLevelUp = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/xpEngine.js', () => ({ processLevelUp: (...a) => processLevelUp(...a), getGuildXpMultiplier: () => 1 }));

const detectSpam = vi.fn();
vi.mock('../src/utils/spamDetector.js', async (importOriginal) => ({ ...(await importOriginal()), detectSpam: (...a) => detectSpam(...a) }));

vi.mock('../src/utils/logEmbeds.js', () => ({
  createSecretLeakLogEmbed: vi.fn(() => ({ kind: 'secret' })),
  createPunishFilterLogEmbed: vi.fn(() => ({ kind: 'punish' })),
  createAntiSpamLogEmbed: vi.fn(() => ({ kind: 'spam' })),
}));

const emit = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/eventBus.js', () => ({ eventBus: { emit: (...a) => emit(...a) } }));

const { execute } = await import('../src/events/messageCreate.js');
const { setAfk, getAfk, clearAfk } = await import('../src/utils/afkStore.js');

const FAKE_KEY = `sk-ant-${'a'.repeat(32)}`;

function makeMessage({ content = 'hola a todos', authorId = 'user-1', bot = false, inGuild = true, roles = [], mentionedUsers = [], attachments = 0, moderatable = true } = {}) {
  return {
    content,
    author: { id: authorId, bot, tag: `${authorId}#0001`, send: vi.fn().mockResolvedValue(undefined), toString: () => `<@${authorId}>` },
    guild: inGuild ? { id: 'guild-1', name: 'Server de prueba' } : null,
    member: { roles: { cache: new Map(roles.map((id) => [id, { id }])) }, moderatable, timeout: vi.fn().mockResolvedValue(undefined) },
    channel: { id: 'chan-1' },
    mentions: { users: new Map(mentionedUsers.map((u) => [u.id, u])), roles: new Map() },
    attachments: { size: attachments },
    delete: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

const client = {};
let logChannel;

beforeEach(() => {
  vi.clearAllMocks();
  logChannel = { send: vi.fn().mockResolvedValue(undefined) };
  getGuildLogChannel.mockResolvedValue(logChannel);
  getGuildConfig.mockResolvedValue({ features: {} });
  grantMessageXp.mockResolvedValue(null);
  detectSpam.mockReturnValue(null);
  for (const id of ['user-1', 'user-2']) clearAfk('guild-1', id);
});

describe('messageCreate — qué mensajes se ignoran', () => {
  it('mensajes de bots y mensajes directos no se procesan ni se cuentan', async () => {
    await execute(makeMessage({ bot: true }), client);
    await execute(makeMessage({ inGuild: false }), client);

    expect(emit).not.toHaveBeenCalled();
    expect(getGuildConfig).not.toHaveBeenCalled();
  });

  it('cualquier mensaje real de un servidor suma a la analítica (MESSAGE_SENT), aunque no dé XP', async () => {
    await execute(makeMessage(), client);

    expect(emit).toHaveBeenCalledWith('MESSAGE_SENT', { guildId: 'guild-1' });
  });
});

describe('messageCreate — detección de claves (siempre activa)', () => {
  it('borra el mensaje, avisa por MD y al log de moderación, y corta todo lo demás — incluso sin /setup', async () => {
    const message = makeMessage({ content: `mi clave es ${FAKE_KEY}` });

    await execute(message, client);

    expect(message.delete).toHaveBeenCalled();
    expect(message.author.send).toHaveBeenCalledWith(expect.stringContaining('Server de prueba'));
    expect(logChannel.send).toHaveBeenCalledWith({ embeds: [{ kind: 'secret' }] });
    expect(getGuildConfig).not.toHaveBeenCalled();
    expect(grantMessageXp).not.toHaveBeenCalled();
  });
});

describe('messageCreate — AFK', () => {
  it('quien estaba AFK y escribe: se le saca el AFK y se le avisa', async () => {
    setAfk('guild-1', 'user-1', 'almorzando');
    const message = makeMessage();

    await execute(message, client);

    expect(getAfk('guild-1', 'user-1')).toBeFalsy();
    expect(message.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('te quité el AFK') }));
  });

  it('mencionar a alguien AFK responde con su motivo, sin volver a arrobarlo', async () => {
    setAfk('guild-1', 'user-2', 'durmiendo');
    const message = makeMessage({ mentionedUsers: [{ id: 'user-2', toString: () => '<@user-2>' }] });

    await execute(message, client);

    const reply = message.reply.mock.calls[0][0];
    expect(reply.content).toContain('durmiendo');
    expect(reply.allowedMentions).toEqual({ repliedUser: false, users: [] });
  });
});

describe('messageCreate — anti-spam', () => {
  it('con moderación activada: borra, aplica timeout de 5 minutos, avisa al log y no da XP', async () => {
    getGuildConfig.mockResolvedValue({ features: { moderacion: true, xp: true } });
    detectSpam.mockReturnValue('flood');
    const message = makeMessage();

    await execute(message, client);

    expect(message.delete).toHaveBeenCalled();
    expect(message.member.timeout).toHaveBeenCalledWith(5 * 60 * 1000, expect.stringContaining('flood'));
    expect(logChannel.send).toHaveBeenCalledWith({ embeds: [{ kind: 'spam' }] });
    expect(grantMessageXp).not.toHaveBeenCalled();
  });

  it('el staff de NEXO nunca pasa por el anti-spam', async () => {
    getGuildConfig.mockResolvedValue({ features: { moderacion: true }, moderator_role_id: 'role-staff' });
    detectSpam.mockReturnValue('flood');
    const message = makeMessage({ roles: ['role-staff'] });

    await execute(message, client);

    expect(detectSpam).not.toHaveBeenCalled();
    expect(message.delete).not.toHaveBeenCalled();
  });

  it('con moderación apagada no se revisa spam', async () => {
    detectSpam.mockReturnValue('flood');
    const message = makeMessage();

    await execute(message, client);

    expect(detectSpam).not.toHaveBeenCalled();
    expect(message.delete).not.toHaveBeenCalled();
  });
});

describe('messageCreate — XP por mensajes', () => {
  it('con XP activado da XP, y si sube de nivel procesa la subida', async () => {
    getGuildConfig.mockResolvedValue({ features: { xp: true } });
    grantMessageXp.mockResolvedValue({ leveledUp: true, previousLevel: 1, newLevel: 2, record: { xp: 150 } });
    const message = makeMessage();

    await execute(message, client);

    expect(grantMessageXp).toHaveBeenCalledWith('guild-1', 'user-1', 'hola a todos', 1);
    expect(processLevelUp).toHaveBeenCalledWith(message.member, { previousLevel: 1, newLevel: 2, totalXp: 150 }, client);
  });

  it('en un canal ignorado para XP no da nada', async () => {
    getGuildConfig.mockResolvedValue({ features: { xp: true }, xp_ignored_channel_ids: ['chan-1'] });

    await execute(makeMessage(), client);

    expect(grantMessageXp).not.toHaveBeenCalled();
  });

  it('con XP apagado no da nada', async () => {
    await execute(makeMessage(), client);

    expect(grantMessageXp).not.toHaveBeenCalled();
  });
});

describe('messageCreate — filtro de sancionados (/punish)', () => {
  const PUNISHED = { features: {}, punish_role_id: 'role-sancionado' };

  it('un sancionado que manda un enlace: se borra y se avisa al log', async () => {
    getGuildConfig.mockResolvedValue(PUNISHED);
    const message = makeMessage({ content: 'miren https://ejemplo.com', roles: ['role-sancionado'] });

    await execute(message, client);

    expect(message.delete).toHaveBeenCalled();
    expect(logChannel.send).toHaveBeenCalledWith({ embeds: [{ kind: 'punish' }] });
  });

  it('un sancionado que manda un archivo: también se borra', async () => {
    getGuildConfig.mockResolvedValue(PUNISHED);
    const message = makeMessage({ content: 'foto', roles: ['role-sancionado'], attachments: 1 });

    await execute(message, client);

    expect(message.delete).toHaveBeenCalled();
  });

  it('un sancionado que solo escribe texto puede seguir hablando', async () => {
    getGuildConfig.mockResolvedValue(PUNISHED);
    const message = makeMessage({ content: 'perdón', roles: ['role-sancionado'] });

    await execute(message, client);

    expect(message.delete).not.toHaveBeenCalled();
  });

  it('alguien sin la sanción puede mandar enlaces', async () => {
    getGuildConfig.mockResolvedValue(PUNISHED);
    const message = makeMessage({ content: 'miren https://ejemplo.com' });

    await execute(message, client);

    expect(message.delete).not.toHaveBeenCalled();
  });
});

describe('messageCreate — un error nunca tira el proceso', () => {
  it('si la configuración no se puede leer, se loguea y no revienta', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getGuildConfig.mockRejectedValue(new Error('supabase caído'));

    await expect(execute(makeMessage(), client)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
