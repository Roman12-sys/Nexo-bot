import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';

// Auditoría completa NEXO (2026-09-11): /voice (el comando, no tempVoiceEngine.js —
// ya cubierto por tempVoiceTransfer.test.js/tempVoiceUnblock.test.js) no tenía NINGÚN
// test propio: ni el gate de isStaff, ni la matriz de sus 5 subcomandos.
const isStaff = vi.fn().mockResolvedValue(true);
vi.mock('../src/utils/permissions.js', () => ({ isStaff: (...a) => isStaff(...a) }));

const getGuildVoiceConfig = vi.fn();
const upsertGuildVoiceConfig = vi.fn().mockResolvedValue(undefined);
const disableGuildVoiceConfig = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/voiceConfigStore.js', () => ({
  getGuildVoiceConfig: (...a) => getGuildVoiceConfig(...a),
  upsertGuildVoiceConfig: (...a) => upsertGuildVoiceConfig(...a),
  disableGuildVoiceConfig: (...a) => disableGuildVoiceConfig(...a),
}));

const getAllTempChannels = vi.fn().mockResolvedValue([]);
const getGuildVoiceStatsSummary = vi.fn();
vi.mock('../src/utils/tempVoiceStore.js', () => ({
  getAllTempChannels: (...a) => getAllTempChannels(...a),
  getGuildVoiceStatsSummary: (...a) => getGuildVoiceStatsSummary(...a),
}));

const buildAdminRoomSelect = vi.fn().mockReturnValue({ toJSON: () => ({}) });
vi.mock('../src/utils/tempVoicePanel.js', () => ({ buildAdminRoomSelect: (...a) => buildAdminRoomSelect(...a) }));

const { execute } = await import('../src/commands/moderacion/voice.js');

function makeInteraction({ sub, options = {}, hasManageChannels = true, hasMoveMembers = true } = {}) {
  const channelFetch = vi.fn(async (id) => ({ id, toString: () => `<#${id}>` }));
  return {
    guild: {
      id: 'guild-1',
      members: {
        me: {
          permissions: {
            has: (perm) => (perm === PermissionFlagsBits.ManageChannels ? hasManageChannels : perm === PermissionFlagsBits.MoveMembers ? hasMoveMembers : true),
          },
        },
      },
      channels: { fetch: channelFetch },
    },
    guildId: 'guild-1',
    options: {
      getSubcommand: () => sub,
      getChannel: (name) => options[name] ?? null,
    },
    reply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    replied: false,
    deferred: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  isStaff.mockResolvedValue(true);
});

describe('/voice — gate de permisos', () => {
  it('sin isStaff: no llega a ningún subcomando', async () => {
    isStaff.mockResolvedValue(false);
    const interaction = makeInteraction({ sub: 'setup', options: { canal: { id: 'chan-1' }, categoria: { id: 'cat-1' } } });

    await execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('permisos') }));
    expect(upsertGuildVoiceConfig).not.toHaveBeenCalled();
  });
});

describe('/voice setup', () => {
  it('al bot le faltan permisos: rechaza sin guardar nada', async () => {
    const interaction = makeInteraction({ sub: 'setup', options: { canal: { id: 'chan-1' }, categoria: { id: 'cat-1' } }, hasManageChannels: false });

    await execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Gestionar canales') }));
    expect(upsertGuildVoiceConfig).not.toHaveBeenCalled();
  });

  it('caso exitoso: guarda canal/categoría y activa el sistema', async () => {
    const interaction = makeInteraction({ sub: 'setup', options: { canal: { id: 'chan-crear' }, categoria: { id: 'cat-salas' } } });

    await execute(interaction);

    expect(upsertGuildVoiceConfig).toHaveBeenCalledWith('guild-1', { createChannelId: 'chan-crear', categoryId: 'cat-salas', enabled: true });
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
  });
});

describe('/voice config', () => {
  it('sin configurar todavía: avisa que falta /voice setup', async () => {
    getGuildVoiceConfig.mockResolvedValue(null);
    const interaction = makeInteraction({ sub: 'config' });

    await execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('/voice setup') }));
  });

  it('configurado: muestra el estado real (activado/desactivado)', async () => {
    getGuildVoiceConfig.mockResolvedValue({ createChannelId: 'chan-1', categoryId: 'cat-1', enabled: true });
    const interaction = makeInteraction({ sub: 'config' });

    await execute(interaction);

    const embed = interaction.reply.mock.calls[0][0].embeds[0];
    const estado = embed.data.fields.find((f) => f.name === 'Estado');
    expect(estado.value).toContain('Activado');
  });

  it('canal guardado ya no existe: lo dice explícito, no inventa un nombre', async () => {
    getGuildVoiceConfig.mockResolvedValue({ createChannelId: 'chan-borrado', categoryId: null, enabled: true });
    const interaction = makeInteraction({ sub: 'config' });
    interaction.guild.channels.fetch = vi.fn().mockResolvedValue(null);

    await execute(interaction);

    const embed = interaction.reply.mock.calls[0][0].embeds[0];
    const canalField = embed.data.fields.find((f) => f.name === 'Canal "Crear sala"');
    expect(canalField.value).toContain('No existe');
  });
});

describe('/voice disable', () => {
  it('ya estaba desactivado: no llama a disableGuildVoiceConfig de nuevo', async () => {
    getGuildVoiceConfig.mockResolvedValue({ enabled: false });
    const interaction = makeInteraction({ sub: 'disable' });

    await execute(interaction);

    expect(disableGuildVoiceConfig).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('ya está desactivado') }));
  });

  it('estaba activado: lo desactiva', async () => {
    getGuildVoiceConfig.mockResolvedValue({ enabled: true });
    const interaction = makeInteraction({ sub: 'disable' });

    await execute(interaction);

    expect(disableGuildVoiceConfig).toHaveBeenCalledWith('guild-1');
  });
});

describe('/voice admin', () => {
  it('sin salas activas: avisa, no arma ningún select', async () => {
    getAllTempChannels.mockResolvedValue([]);
    const interaction = makeInteraction({ sub: 'admin' });

    await execute(interaction);

    expect(buildAdminRoomSelect).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No hay salas') }));
  });

  it('con salas activas: arma el select real con los registros', async () => {
    const records = [{ channelId: 'chan-1', ownerId: 'owner-1' }];
    getAllTempChannels.mockResolvedValue(records);
    const interaction = makeInteraction({ sub: 'admin' });

    await execute(interaction);

    expect(buildAdminRoomSelect).toHaveBeenCalledWith(records, interaction.guild);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('(1)') }));
  });
});

describe('/voice estadisticas', () => {
  it('sin ninguna sala cerrada todavía: lo dice explícito', async () => {
    getGuildVoiceStatsSummary.mockResolvedValue({ totalSessions: 0, totalDurationSeconds: 0, peakConcurrent: 0, topOwners: [] });
    const interaction = makeInteraction({ sub: 'estadisticas' });

    await execute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('ninguna sala') }));
  });

  it('con datos: muestra el resumen real, incluido el top de dueños', async () => {
    getGuildVoiceStatsSummary.mockResolvedValue({
      totalSessions: 12,
      totalDurationSeconds: 7384,
      peakConcurrent: 5,
      topOwners: [{ ownerId: 'owner-1', durationSeconds: 3600, sessions: 4 }],
    });
    const interaction = makeInteraction({ sub: 'estadisticas' });

    await execute(interaction);

    const embed = interaction.editReply.mock.calls[0][0].embeds[0];
    const sesiones = embed.data.fields.find((f) => f.name.includes('Salas cerradas'));
    expect(sesiones.value).toBe('12');
    const top = embed.data.fields.find((f) => f.name.includes('Top dueños'));
    expect(top.value).toContain('owner-1');
  });
});

describe('/voice — manejo de errores', () => {
  it('un error inesperado en un subcomando responde con mensaje genérico en vez de reventar', async () => {
    getGuildVoiceConfig.mockRejectedValue(new Error('supabase caído'));
    const interaction = makeInteraction({ sub: 'config' });

    await expect(execute(interaction)).resolves.not.toThrow();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('error') }));
  });
});
