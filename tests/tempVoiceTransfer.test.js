import { vi, describe, it, expect, beforeEach } from 'vitest';

// Auditoría completa NEXO (2026-09-11), hallazgos VOICE-1/VOICE-2 en dominio
// arquitectura/concurrencia:
//
// VOICE-1: al transferir la propiedad de una sala de voz temporal, el código solo
// AGREGABA el overwrite del nuevo dueño (permissionOverwrites.edit) pero nunca borraba
// el del dueño saliente — quien transfería una sala PRIVADA seguía pudiendo verla y
// conectarse después de "perderla", sin ninguna señal visible para el nuevo dueño o
// staff (el panel "Desbloquear" solo lista overwrites con deny, el del dueño viejo es
// un allow). 100% reproducible, sin necesitar ninguna condición de carrera.
//
// VOICE-2: el lock de transferencia estaba keyeado por `voice_transfer_owner:{guild}:
// {newOwnerId}` — protegía a la MISMA persona recibiendo dos salas a la vez, pero no
// protegía la MISMA sala siendo transferida a dos destinatarios distintos en paralelo
// (ej. el dueño eligiendo a X desde el panel mientras /voice admin transfiere a Y). Fix:
// la key pasa a ser por canal (`voice_transfer:{guild}:{channelId}`), que serializa
// cualquier par de transferencias sobre la misma sala sin importar el destinatario.

const getTempChannelByChannelId = vi.fn();
const getTempChannelByOwner = vi.fn();
const transferTempChannelOwner = vi.fn();

vi.mock('../src/utils/tempVoiceStore.js', () => ({
  createTempChannel: vi.fn(),
  getTempChannelByChannelId: (...a) => getTempChannelByChannelId(...a),
  getTempChannelByOwner: (...a) => getTempChannelByOwner(...a),
  updateTempChannel: vi.fn(),
  deleteTempChannel: vi.fn().mockResolvedValue(undefined),
  transferTempChannelOwner: (...a) => transferTempChannelOwner(...a),
  getAllTempChannels: vi.fn(),
  recordChannelStats: vi.fn(),
  getGuildVoiceStatsSummary: vi.fn(),
}));

vi.mock('../src/utils/voiceConfigStore.js', () => ({
  getGuildVoiceConfig: vi.fn(),
  upsertGuildVoiceConfig: vi.fn(),
  disableGuildVoiceConfig: vi.fn(),
}));

const { handleTransferSelect } = await import('../src/utils/tempVoiceEngine.js');

function makeChannel({ editImpl, deleteImpl } = {}) {
  return {
    permissionOverwrites: {
      edit: editImpl || vi.fn().mockResolvedValue(undefined),
      delete: deleteImpl || vi.fn().mockResolvedValue(undefined),
    },
  };
}

function makeInteraction({ guildId = 'guild-1', ownerId = 'owner-1', newOwnerId = 'new-owner-1', channel } = {}) {
  return {
    guild: { id: guildId, channels: { fetch: vi.fn().mockResolvedValue(channel) } },
    user: { id: ownerId },
    values: [newOwnerId],
    update: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getTempChannelByOwner.mockResolvedValue(null);
  transferTempChannelOwner.mockResolvedValue(undefined);
});

describe('handleTransferSelect — VOICE-1: limpieza del overwrite del dueño saliente', () => {
  it('borra el overwrite individual del dueño anterior después de darle acceso al nuevo', async () => {
    getTempChannelByChannelId.mockResolvedValue({ ownerId: 'owner-1' });
    const channel = makeChannel();
    const interaction = makeInteraction({ ownerId: 'owner-1', newOwnerId: 'new-owner-1', channel });

    await handleTransferSelect(interaction, 'chan-1');

    expect(channel.permissionOverwrites.edit).toHaveBeenCalledWith('new-owner-1', expect.objectContaining({ Connect: true }));
    expect(channel.permissionOverwrites.delete).toHaveBeenCalledWith('owner-1');
    expect(interaction.update).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('ahora es el propietario') }));
  });

  it('si borrar el overwrite viejo falla (ya no existía), la transferencia igual se confirma', async () => {
    getTempChannelByChannelId.mockResolvedValue({ ownerId: 'owner-1' });
    const channel = makeChannel({ deleteImpl: vi.fn().mockRejectedValue(new Error('Unknown Overwrite')) });
    const interaction = makeInteraction({ ownerId: 'owner-1', newOwnerId: 'new-owner-1', channel });

    await expect(handleTransferSelect(interaction, 'chan-1')).resolves.not.toThrow();
    expect(transferTempChannelOwner).toHaveBeenCalledWith('guild-1', 'chan-1', 'new-owner-1');
  });
});

describe('handleTransferSelect — VOICE-2: lock por sala, no por destinatario', () => {
  it('dos transferencias de la MISMA sala a destinatarios distintos se serializan (la segunda espera a la primera)', async () => {
    getTempChannelByChannelId.mockResolvedValue({ ownerId: 'owner-1' });

    const order = [];
    // El "edit" de la primera transferencia tarda un poco — si el lock fuera por
    // newOwnerId (el bug original), la segunda transferencia (a un newOwnerId distinto)
    // entraría en paralelo y su propio "edit" terminaría ANTES que el de la primera.
    const channel = makeChannel({
      editImpl: vi.fn().mockImplementation(async (targetId) => {
        order.push(`edit-start:${targetId}`);
        if (targetId === 'rival-x') await new Promise((r) => setTimeout(r, 30));
        order.push(`edit-end:${targetId}`);
      }),
    });

    const interactionToX = makeInteraction({ ownerId: 'owner-1', newOwnerId: 'rival-x', channel });
    const interactionToY = makeInteraction({ ownerId: 'owner-1', newOwnerId: 'rival-y', channel });

    // Mismo channelId ("chan-1") para las dos — misma sala, dos destinatarios.
    await Promise.all([handleTransferSelect(interactionToX, 'chan-1'), handleTransferSelect(interactionToY, 'chan-1')]);

    // Con el lock por canal, la segunda transferencia (Y) nunca puede empezar su propio
    // "edit" hasta que la primera (X) termine el suyo por completo.
    const xEnd = order.indexOf('edit-end:rival-x');
    const yStart = order.indexOf('edit-start:rival-y');
    expect(xEnd).toBeGreaterThanOrEqual(0);
    expect(yStart).toBeGreaterThan(xEnd);
  });
});
