import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// /report (Fase 4C-1) — reutiliza getGuildLogChannel (mismo helper que /warn, /ban,
// etc.), con fallback de 'report' a 'moderation' si el servidor no configuró un canal
// dedicado. Se mockea guildLogChannels.js entero, mismo patrón que setupRoleSafety.test.js.
const getGuildLogChannel = vi.fn();
vi.mock('../src/utils/guildLogChannels.js', () => ({ getGuildLogChannel }));

const { execute } = await import('../src/commands/utilidad/report.js');

function makeInteraction({
  guildId = 'guild-1',
  userId = 'user-1',
  channelId = 'chan-1',
  motivo = 'Está insultando a todos en el canal',
  usuario = null,
  mensaje = null,
  fetchMessageImpl = null,
  channelsFetchImpl = null,
} = {}) {
  const currentChannel = {
    isTextBased: () => true,
    messages: { fetch: fetchMessageImpl || vi.fn().mockResolvedValue({ content: 'contenido original del mensaje' }) },
  };

  return {
    guildId,
    channelId,
    user: { id: userId, tag: `user-${userId}#0001` },
    channel: currentChannel,
    guild: { channels: { fetch: channelsFetchImpl || vi.fn().mockResolvedValue(currentChannel) } },
    client: {},
    options: {
      getString: (name) => (name === 'motivo' ? motivo : name === 'mensaje' ? mensaje : null),
      getUser: (name) => (name === 'usuario' ? usuario : null),
    },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

const reportChannelMock = { send: vi.fn().mockResolvedValue(undefined) };
const moderationChannelMock = { send: vi.fn().mockResolvedValue(undefined) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // Default: sin canal de reportes dedicado, pero SÍ hay log de moderación (el caso más
  // común — /setup ya lo crea) — así el fallback se ejercita por defecto en casi todos
  // los tests, salvo los que explícitamente prueban lo contrario.
  getGuildLogChannel.mockImplementation(async (_client, _guildId, category) => {
    if (category === 'report') return null;
    if (category === 'moderation') return moderationChannelMock;
    return null;
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('/report — reporte válido', () => {
  it('solo motivo (reporte de "una situación"): se envía al log de moderación (fallback)', async () => {
    const interaction = makeInteraction({ userId: 'rep-1' });

    await execute(interaction);

    expect(moderationChannelMock.send).toHaveBeenCalledTimes(1);
    const embed = moderationChannelMock.send.mock.calls[0][0].embeds[0];
    expect(embed.data.title).toContain('reporte');
    expect(embed.data.fields.some((f) => f.name === 'Motivo')).toBe(true);
    expect(embed.data.fields.some((f) => f.name === 'Usuario reportado')).toBe(false);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('✅') }));
  });

  it('con usuario reportado: lo incluye en el embed', async () => {
    const interaction = makeInteraction({ userId: 'rep-2', usuario: { id: 'target-1', tag: 'target-1#0001' } });

    await execute(interaction);

    const embed = moderationChannelMock.send.mock.calls[0][0].embeds[0];
    const field = embed.data.fields.find((f) => f.name === 'Usuario reportado');
    expect(field.value).toContain('target-1#0001');
    expect(field.value).toContain('target-1');
  });

  it('usa report_channel_id cuando está configurado, en vez del fallback de moderación', async () => {
    getGuildLogChannel.mockImplementation(async (_client, _guildId, category) => (category === 'report' ? reportChannelMock : moderationChannelMock));
    const interaction = makeInteraction({ userId: 'rep-3' });

    await execute(interaction);

    expect(reportChannelMock.send).toHaveBeenCalledTimes(1);
    expect(moderationChannelMock.send).not.toHaveBeenCalled();
  });
});

describe('/report — referencia a un mensaje', () => {
  it('ID crudo (mensaje del canal actual): resuelve y muestra el contenido', async () => {
    const interaction = makeInteraction({ userId: 'rep-4', mensaje: '123456789012345678' });

    await execute(interaction);

    const embed = moderationChannelMock.send.mock.calls[0][0].embeds[0];
    const field = embed.data.fields.find((f) => f.name === 'Mensaje reportado');
    expect(field.value).toContain('contenido original del mensaje');
    expect(field.value).toContain('123456789012345678');
  });

  it('link completo de mensaje de ESTE servidor: resuelve el canal correcto', async () => {
    // Los segmentos de un link real de Discord son siempre snowflakes numéricos — el
    // parser los valida con \d+, así que el guildId/channelId acá tienen que ser
    // numéricos de verdad para ejercitar el camino de "link válido" (a diferencia del
    // resto de este archivo, que usa IDs de string libres donde el link no entra en juego).
    const otherChannel = { isTextBased: () => true, messages: { fetch: vi.fn().mockResolvedValue({ content: 'en otro canal' }) } };
    const channelsFetchImpl = vi.fn().mockResolvedValue(otherChannel);
    const interaction = makeInteraction({
      userId: 'rep-5',
      guildId: '111111111111111111',
      channelId: '222222222222222222',
      mensaje: 'https://discord.com/channels/111111111111111111/333333333333333333/444444444444444444',
      channelsFetchImpl,
    });

    await execute(interaction);

    expect(channelsFetchImpl).toHaveBeenCalledWith('333333333333333333');
    const embed = moderationChannelMock.send.mock.calls[0][0].embeds[0];
    expect(embed.data.fields.find((f) => f.name === 'Mensaje reportado').value).toContain('en otro canal');
  });

  it('link de mensaje de OTRO servidor: se rechaza sin llegar a enviar nada', async () => {
    const interaction = makeInteraction({
      userId: 'rep-6',
      guildId: '111111111111111111',
      mensaje: 'https://discord.com/channels/999999999999999999/222222222222222222/333333333333333333',
    });

    await execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('no pertenece a este servidor') }));
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(moderationChannelMock.send).not.toHaveBeenCalled();
  });

  it('formato inválido de "mensaje": se rechaza con un mensaje claro', async () => {
    const interaction = makeInteraction({ userId: 'rep-7', mensaje: 'no-es-ni-un-link-ni-un-id' });

    await execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('link de mensaje') }));
    expect(moderationChannelMock.send).not.toHaveBeenCalled();
  });

  it('mensaje borrado/inaccesible (fetch falla): el reporte sigue adelante igual, sin contenido', async () => {
    const interaction = makeInteraction({
      userId: 'rep-8',
      mensaje: '123456789012345678',
      fetchMessageImpl: vi.fn().mockRejectedValue(new Error('Unknown Message')),
    });

    await expect(execute(interaction)).resolves.not.toThrow();
    const embed = moderationChannelMock.send.mock.calls[0][0].embeds[0];
    const field = embed.data.fields.find((f) => f.name === 'Mensaje reportado');
    expect(field.value).toContain('no se pudo leer');
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('✅') }));
  });
});

describe('/report — cooldown por guild+usuario', () => {
  it('segundo intento inmediato del mismo usuario: bloqueado por cooldown', async () => {
    const first = makeInteraction({ userId: 'cd-1' });
    await execute(first);

    const second = makeInteraction({ userId: 'cd-1' });
    await execute(second);

    expect(second.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Ya mandaste un reporte hace poco') }));
    expect(second.deferReply).not.toHaveBeenCalled();
  });

  it('mismo usuario en OTRO servidor: no comparte el cooldown', async () => {
    const inGuildA = makeInteraction({ guildId: 'guild-a', userId: 'cd-2' });
    await execute(inGuildA);

    const inGuildB = makeInteraction({ guildId: 'guild-b', userId: 'cd-2' });
    await execute(inGuildB);

    expect(inGuildB.deferReply).toHaveBeenCalledTimes(1);
  });

  it('usuarios distintos en el mismo servidor: cooldowns independientes', async () => {
    const first = makeInteraction({ userId: 'cd-3a' });
    await execute(first);

    const second = makeInteraction({ userId: 'cd-3b' });
    await execute(second);

    expect(second.deferReply).toHaveBeenCalledTimes(1);
  });

  it('un intento rechazado por link de otro servidor no consume el cooldown', async () => {
    const invalid = makeInteraction({ userId: 'cd-4', mensaje: 'https://discord.com/channels/otro-guild/c/m' });
    await execute(invalid);

    const valid = makeInteraction({ userId: 'cd-4' });
    await execute(valid);

    expect(valid.deferReply).toHaveBeenCalledTimes(1);
  });

  it('pasada la ventana de cooldown (60s), se puede reportar de nuevo', async () => {
    const first = makeInteraction({ userId: 'cd-5' });
    await execute(first);

    vi.setSystemTime(Date.now() + 60 * 1000 + 1);

    const second = makeInteraction({ userId: 'cd-5' });
    await execute(second);

    expect(second.deferReply).toHaveBeenCalledTimes(1);
  });
});

describe('/report — sin configuración de canal', () => {
  it('sin report_channel_id NI log de moderación: avisa que no se pudo entregar, sin fingir éxito', async () => {
    getGuildLogChannel.mockResolvedValue(null);
    const interaction = makeInteraction({ userId: 'nc-1' });

    await execute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('❌') }));
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('canal-reportes') }));
  });
});

describe('/report — errores al entregar', () => {
  it('el canal existe pero el envío falla (permiso/rate limit): avisa sin reventar', async () => {
    const failingChannel = { send: vi.fn().mockRejectedValue(new Error('Missing Access')) };
    getGuildLogChannel.mockImplementation(async (_client, _guildId, category) => (category === 'moderation' ? failingChannel : null));
    const interaction = makeInteraction({ userId: 'err-1' });

    await expect(execute(interaction)).resolves.not.toThrow();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No se pudo entregar el reporte') }));
  });
});
