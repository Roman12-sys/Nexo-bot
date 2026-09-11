import { vi, describe, it, expect, beforeEach } from 'vitest';

// Auditoría adversarial round 2, Bloque 1 — mismo defecto que /setup (ver
// setupSessionIsolation.test.js): el draft en memoria de /anuncio estaba indexado
// SOLO por userId. Un staff con ManageGuild en dos servidores (escenario esperado —
// Nexo es multi-tenant) que abre /anuncio en el Guild A y, antes de enviar, abre
// /anuncio en el Guild B, pisaba silenciosamente el draft de A — "Enviar" en el panel
// de A terminaba publicando el contenido de B. El fix compone la key como
// `${guildId}:${userId}`.
const isStaff = vi.fn().mockResolvedValue(true);
vi.mock('../src/utils/permissions.js', () => ({ isStaff }));

const { startBuilder } = await import('../src/commands/anuncios/anuncio.js');
const { routeButton } = await import('../src/components/buttons.js');
const { routeModal } = await import('../src/components/modals.js');

function makeInteraction({ userId, guildId }) {
  const channelSend = vi.fn().mockResolvedValue(undefined);
  return {
    guild: { id: guildId },
    guildId,
    channel: { send: channelSend },
    user: { id: userId, tag: `${userId}#0001` },
    reply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    showModal: vi.fn().mockResolvedValue(undefined),
  };
}

function click(base, customId) {
  return { ...base, customId, update: vi.fn().mockResolvedValue(undefined), reply: vi.fn().mockResolvedValue(undefined), showModal: vi.fn().mockResolvedValue(undefined) };
}

function submitContentModal(base, { titulo, descripcion }) {
  return {
    ...base,
    customId: 'modal_anuncio_content',
    update: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    fields: {
      getTextInputValue: (id) => ({ titulo, descripcion, url: '' })[id] ?? '',
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  isStaff.mockResolvedValue(true);
});

describe('/anuncio — aislamiento de sesión cross-guild', () => {
  it('escenario del bug: mismo staff, guild A arma un anuncio, guild B arma OTRO antes de enviar — enviar en A publica SOLO el contenido de A', async () => {
    const userId = 'staff-1';
    const interactionA = makeInteraction({ userId, guildId: 'guild-A' });
    const interactionB = makeInteraction({ userId, guildId: 'guild-B' });

    // 1) abre /anuncio en A y carga contenido de A
    await startBuilder(interactionA);
    await routeModal(submitContentModal(interactionA, { titulo: 'Aviso de A', descripcion: 'Contenido exclusivo de A' }));

    // 2) SIN enviar A, el mismo staff abre /anuncio en B y carga contenido DISTINTO
    await startBuilder(interactionB);
    await routeModal(submitContentModal(interactionB, { titulo: 'Aviso de B', descripcion: 'Contenido exclusivo de B' }));

    // 3) vuelve al panel de A y aprieta "Enviar"
    const sendA = click(interactionA, 'anuncio_send');
    await routeButton(sendA);

    // El envío tuvo que pasar por el CANAL de A, con el contenido de A — nunca el de B.
    expect(interactionA.channel.send).toHaveBeenCalledTimes(1);
    expect(interactionB.channel.send).not.toHaveBeenCalled();
    const sentEmbed = interactionA.channel.send.mock.calls[0][0].embeds[0];
    expect(sentEmbed.data.title).toBe('Aviso de A');
    expect(sentEmbed.data.description).toBe('Contenido exclusivo de A');

    // 4) enviar B por separado sigue funcionando con SU propio contenido.
    const sendB = click(interactionB, 'anuncio_send');
    await routeButton(sendB);
    expect(interactionB.channel.send).toHaveBeenCalledTimes(1);
    const sentEmbedB = interactionB.channel.send.mock.calls[0][0].embeds[0];
    expect(sentEmbedB.data.title).toBe('Aviso de B');
  });

  it('dos usuarios distintos con /anuncio abierto en el mismo guild no interfieren entre sí', async () => {
    const guildId = 'guild-shared';
    const interactionU1 = makeInteraction({ userId: 'staff-1', guildId });
    const interactionU2 = makeInteraction({ userId: 'staff-2', guildId });

    await startBuilder(interactionU1);
    await routeModal(submitContentModal(interactionU1, { titulo: 'De user 1', descripcion: 'contenido 1' }));

    await startBuilder(interactionU2);
    await routeModal(submitContentModal(interactionU2, { titulo: 'De user 2', descripcion: 'contenido 2' }));

    await routeButton(click(interactionU1, 'anuncio_send'));

    const sentEmbed = interactionU1.channel.send.mock.calls[0][0].embeds[0];
    expect(sentEmbed.data.title).toBe('De user 1');
    expect(interactionU2.channel.send).not.toHaveBeenCalled();
  });

  it('cancelar en un guild no afecta la sesión abierta del mismo usuario en otro guild', async () => {
    const userId = 'staff-1';
    const interactionA = makeInteraction({ userId, guildId: 'guild-A' });
    const interactionB = makeInteraction({ userId, guildId: 'guild-B' });

    await startBuilder(interactionA);
    await routeModal(submitContentModal(interactionA, { titulo: 'A', descripcion: 'contenido A' }));

    await startBuilder(interactionB);
    await routeButton(click(interactionB, 'anuncio_cancel'));

    // La sesión de A sigue viva pese a haberse cancelado la de B.
    const sendA = click(interactionA, 'anuncio_send');
    await routeButton(sendA);
    expect(interactionA.channel.send).toHaveBeenCalledTimes(1);

    // La de B, en cambio, ya expiró.
    const sendB = click(interactionB, 'anuncio_send');
    await routeButton(sendB);
    expect(sendB.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('expiró') }));
  });
});
