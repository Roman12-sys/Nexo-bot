import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeButtonInteraction } from './helpers/discordMock.js';

// /report (Fase 4C-1) — reutiliza getGuildLogChannel (mismo helper que /warn, /ban,
// etc.), con fallback de 'report' a 'moderation' si el servidor no configuró un canal
// dedicado. Se mockea guildLogChannels.js entero, mismo patrón que setupRoleSafety.test.js.
const getGuildLogChannel = vi.fn();
vi.mock('../src/utils/guildLogChannels.js', () => ({ getGuildLogChannel }));

// Ciclo 2, Bloque 10 — handleStatusButton usa isStaff(), que lee guild_config real.
// Mismo patrón que sanciones.test.js: se mockea guildConfigStore.js entero.
const getGuildConfig = vi.fn();
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig }));

const { execute } = await import('../src/commands/utilidad/report.js');
const { routeButton } = await import('../src/components/buttons.js');

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

// Ciclo 2, Bloque 10 — antes /report era un buzón muerto: llegaba al canal de staff y
// ahí terminaba, sin ninguna señal de si alguien lo había atendido. El estado
// (Pendiente/Visto/Resuelto) vive DENTRO del propio embed del mensaje — nunca en
// Supabase ni en un Map en memoria — así que sobrevive un restart del bot gratis (el
// mensaje de Discord ya persiste solo) sin necesitar tabla nueva ni reconciliación al
// arrancar.
function makeReportEmbedData(fields) {
  const data = { title: '🚨 Nuevo reporte', fields };
  // Mismo shape que el `Embed` real de discord.js (interaction.message.embeds[0]):
  // expone `.data` Y `toJSON()` — EmbedBuilder.from() los soporta a los dos, pero acá
  // se imita el real para no depender de un atajo que solo funciona en el mock.
  return { data, toJSON: () => data };
}

function makeStatusInteraction(customId, { userId = 'mod-1', guildId = 'guild-1', staffRoleIds = [], fields = [{ name: 'Estado', value: '🔴 Pendiente' }] } = {}) {
  return makeButtonInteraction(customId, {
    userId,
    guildId,
    base: {
      member: { roles: { cache: new Map(staffRoleIds.map((id) => [id, { id }])) } },
      message: { embeds: [makeReportEmbedData(fields)] },
    },
  });
}

describe('/report — estado del reporte (Bloque 10: Pendiente/Visto/Resuelto)', () => {
  const STAFF_CFG = { moderator_role_id: 'mod-role', admin_role_id: 'admin-role' };

  beforeEach(() => {
    getGuildConfig.mockResolvedValue(STAFF_CFG);
  });

  it('reporte recién creado: arranca en estado Pendiente, con los botones Visto/Resuelto', async () => {
    const interaction = makeInteraction({ userId: 'rep-est-1' });

    await execute(interaction);

    const call = moderationChannelMock.send.mock.calls[0][0];
    const embed = call.embeds[0];
    expect(embed.data.fields.find((f) => f.name === 'Estado').value).toBe('🔴 Pendiente');
    const buttons = call.components[0].components;
    expect(buttons.map((b) => b.data.custom_id)).toEqual(['report_status_visto', 'report_status_resuelto']);
  });

  it('staff puede marcar "Visto": actualiza Estado + color, reconstruye los mismos 2 botones', async () => {
    const interaction = makeStatusInteraction('report_status_visto', { staffRoleIds: ['mod-role'] });

    await routeButton(interaction);

    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.update).toHaveBeenCalledTimes(1);
    const payload = interaction.update.mock.calls[0][0];
    const updatedFields = payload.embeds[0].data.fields;
    expect(updatedFields.find((f) => f.name === 'Estado').value).toMatch(/^👀 Visto por/);
    expect(payload.embeds[0].data.color).toBe(Number('0x7F5AF0'));
    expect(payload.components[0].components.map((b) => b.data.custom_id)).toEqual(['report_status_visto', 'report_status_resuelto']);
  });

  it('staff puede marcar "Resuelto": actualiza Estado + color distinto de "Visto"', async () => {
    const interaction = makeStatusInteraction('report_status_resuelto', { staffRoleIds: ['mod-role'] });

    await routeButton(interaction);

    const payload = interaction.update.mock.calls[0][0];
    expect(payload.embeds[0].data.fields.find((f) => f.name === 'Estado').value).toMatch(/^✅ Resuelto por/);
    expect(payload.embeds[0].data.color).toBe(Number('0x2A9D8F'));
  });

  it('se puede pasar de Visto a Resuelto sobre el mismo mensaje (no queda pegado en un estado)', async () => {
    const interaction = makeStatusInteraction('report_status_resuelto', {
      staffRoleIds: ['mod-role'],
      fields: [{ name: 'Estado', value: '👀 Visto por <@mod-1> — <t:1:R>' }],
    });

    await routeButton(interaction);

    expect(interaction.update.mock.calls[0][0].embeds[0].data.fields.find((f) => f.name === 'Estado').value).toMatch(/^✅ Resuelto por/);
  });

  it('el cambio de estado NO toca ningún otro campo del embed original (usuario/mensaje/motivo/canal)', async () => {
    const originalFields = [
      { name: 'Reportado por', value: 'user-rep#0001 (`user-rep`)' },
      { name: 'Canal', value: '<#chan-1>' },
      { name: 'Usuario reportado', value: 'target#0001 (`target-1`)' },
      { name: 'Mensaje reportado', value: '[Ir al mensaje](url)\ncontenido original' },
      { name: 'Motivo', value: 'insulta a todos en el canal' },
      { name: 'Estado', value: '🔴 Pendiente' },
    ];
    const interaction = makeStatusInteraction('report_status_resuelto', { staffRoleIds: ['mod-role'], fields: originalFields });

    await routeButton(interaction);

    const updatedFields = interaction.update.mock.calls[0][0].embeds[0].data.fields;
    expect(updatedFields).toHaveLength(originalFields.length);
    for (const f of originalFields) {
      if (f.name === 'Estado') continue;
      expect(updatedFields.find((uf) => uf.name === f.name).value).toBe(f.value);
    }
  });

  it('un usuario sin el rol de staff no puede cambiar el estado (ni ephemeral revela nada al mensaje público)', async () => {
    const interaction = makeStatusInteraction('report_status_visto', { staffRoleIds: [] });

    await routeButton(interaction);

    expect(interaction.update).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Solo el staff') }));
  });

  it('mensaje sin embed legible (borrado/corrupto): avisa en vez de fallar en silencio', async () => {
    const interaction = makeButtonInteraction('report_status_visto', {
      staffRoleIds: ['mod-role'],
      base: { member: { roles: { cache: new Map([['mod-role', { id: 'mod-role' }]]) } }, message: { embeds: [] } },
    });

    await routeButton(interaction);

    expect(interaction.update).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No se pudo leer este reporte') }));
  });

  it('persistencia tras un restart conceptual: el estado depende SOLO del embed del mensaje, nunca de un Map en memoria del proceso', async () => {
    // No hay ningún módulo de estado importado/mockeado para el status de un reporte
    // (a diferencia del cooldown de creación, que sí usa un Map interno) — dos clicks
    // sobre mensajes con contenido de partida distinto se resuelven de forma
    // completamente independiente, prueba de que "reiniciar el proceso" no puede perder
    // nada: el único input es lo que ya vino en `interaction.message`.
    const pendiente = makeStatusInteraction('report_status_visto', { staffRoleIds: ['mod-role'], fields: [{ name: 'Estado', value: '🔴 Pendiente' }] });
    const yaVisto = makeStatusInteraction('report_status_resuelto', {
      staffRoleIds: ['mod-role'],
      fields: [{ name: 'Estado', value: '👀 Visto por otro-mod — <t:1:R>' }],
    });

    await routeButton(pendiente);
    await routeButton(yaVisto);

    expect(pendiente.update.mock.calls[0][0].embeds[0].data.fields.find((f) => f.name === 'Estado').value).toMatch(/^👀 Visto por/);
    expect(yaVisto.update.mock.calls[0][0].embeds[0].data.fields.find((f) => f.name === 'Estado').value).toMatch(/^✅ Resuelto por/);
  });
});
