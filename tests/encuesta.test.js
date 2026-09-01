import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// /encuesta — Fase 2B, sección 12: antes no existía ningún límite; ahora hay un
// cooldown de 2 min por guild+usuario contra spam de creación.
const emit = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/eventBus.js', () => ({ eventBus: { emit } }));

const { execute: encuestaExecute } = await import('../src/commands/utilidad/encuesta.js');
const { routeButton } = await import('../src/components/buttons.js');

function makeReaction(name, count) {
  return { emoji: { name }, count };
}

function makeInteraction({ guildId = 'guild-1', userId = 'user-1', pregunta = '¿Café o té?', opciones = null } = {}) {
  const message = { react: vi.fn().mockResolvedValue(undefined) };
  return {
    guild: { id: guildId },
    guildId,
    user: { id: userId, tag: `user-${userId}#0001` },
    options: {
      getString: (name) => (name === 'pregunta' ? pregunta : opciones),
    },
    reply: vi.fn().mockResolvedValue(undefined),
    fetchReply: vi.fn().mockResolvedValue(message),
    message,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('/encuesta — cooldown por guild+usuario', () => {
  it('encuesta válida: se publica y siembra las reacciones', async () => {
    const interaction = makeInteraction({ userId: 'poll-1' });

    await encuestaExecute(interaction);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(interaction.message.react).toHaveBeenCalledWith('👍');
    expect(interaction.message.react).toHaveBeenCalledWith('👎');
  });

  it('segundo intento inmediato del mismo usuario: bloqueado por cooldown', async () => {
    const first = makeInteraction({ userId: 'poll-2' });
    await encuestaExecute(first);

    const second = makeInteraction({ userId: 'poll-2' });
    await encuestaExecute(second);

    expect(second.reply).toHaveBeenCalledTimes(1);
    expect(second.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Ya creaste una encuesta') }));
    expect(second.fetchReply).not.toHaveBeenCalled();
  });

  it('mismo usuario en OTRO servidor: no comparte el cooldown', async () => {
    const inGuildA = makeInteraction({ guildId: 'guild-a', userId: 'poll-3' });
    await encuestaExecute(inGuildA);

    const inGuildB = makeInteraction({ guildId: 'guild-b', userId: 'poll-3' });
    await encuestaExecute(inGuildB);

    expect(inGuildB.fetchReply).toHaveBeenCalledTimes(1);
  });

  it('un intento rechazado por opciones inválidas no consume el cooldown', async () => {
    const invalid = makeInteraction({ userId: 'poll-4', opciones: 'una-sola-opcion' });
    await encuestaExecute(invalid);
    expect(invalid.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('entre 2 y 10') }));

    const valid = makeInteraction({ userId: 'poll-4' });
    await encuestaExecute(valid);

    expect(valid.fetchReply).toHaveBeenCalledTimes(1);
  });

  it('pasada la ventana de cooldown, se puede crear otra', async () => {
    const first = makeInteraction({ userId: 'poll-5' });
    await encuestaExecute(first);

    vi.setSystemTime(Date.now() + 2 * 60 * 1000 + 1);

    const second = makeInteraction({ userId: 'poll-5' });
    await encuestaExecute(second);

    expect(second.fetchReply).toHaveBeenCalledTimes(1);
  });
});

// Bug reportado en vivo 2026-09-01: cerrar una encuesta mostraba siempre "0 votos" en
// todas las opciones, aunque la gente sí hubiera votado. Causa: interaction.message
// puede traer el conteo de reacciones desactualizado (el bot no tiene el intent
// GuildMessageReactions, así que discord.js nunca se entera de reacciones nuevas vía
// gateway) — el fix pega un fetch explícito a la API antes de contar.
describe('/encuesta — cerrar (conteo de votos)', () => {
  function makeCloseInteraction({ staleReactions, freshReactions, fetchImpl } = {}) {
    const freshMessage = {
      reactions: { cache: freshReactions, removeAll: vi.fn().mockResolvedValue(undefined) },
      embeds: [{ footer: { text: 'pie original' } }],
    };
    const staleMessage = {
      reactions: { cache: staleReactions },
      embeds: [{ footer: { text: 'pie original' } }],
      fetch: fetchImpl || vi.fn().mockResolvedValue(freshMessage),
    };

    return {
      customId: 'encuesta_cerrar_creator-1',
      user: { id: 'creator-1', tag: 'creator-1#0001' },
      message: staleMessage,
      update: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
      _staleMessage: staleMessage,
      _freshMessage: freshMessage,
    };
  }

  it('usa el conteo FRESCO de message.fetch(), no el de interaction.message (que puede estar desactualizado)', async () => {
    const interaction = makeCloseInteraction({
      staleReactions: [makeReaction('👍', 1), makeReaction('👎', 1)], // solo la siembra del bot
      freshReactions: [makeReaction('👍', 4), makeReaction('👎', 1)], // 3 votos reales + la siembra
    });

    const handled = await routeButton(interaction);

    expect(handled).toBe(true);
    expect(interaction._staleMessage.fetch).toHaveBeenCalledTimes(1);
    const closedEmbed = interaction.update.mock.calls[0][0].embeds[0];
    const resultField = closedEmbed.data.fields.find((f) => f.name.includes('Resultado final'));
    expect(resultField.value).toContain('👍 — **3** voto(s)');
    expect(resultField.value).toContain('👎 — **0** voto(s)');
    expect(interaction._freshMessage.reactions.removeAll).toHaveBeenCalledTimes(1);
  });

  it('si el fetch falla, sigue adelante con lo que ya tenía (no revienta el cierre)', async () => {
    const interaction = makeCloseInteraction({
      staleReactions: [makeReaction('👍', 3)],
      fetchImpl: vi.fn().mockRejectedValue(new Error('rate limited')),
    });
    interaction._staleMessage.reactions.removeAll = vi.fn().mockResolvedValue(undefined);

    await expect(routeButton(interaction)).resolves.toBe(true);
    const closedEmbed = interaction.update.mock.calls[0][0].embeds[0];
    const resultField = closedEmbed.data.fields.find((f) => f.name.includes('Resultado final'));
    expect(resultField.value).toContain('👍 — **2** voto(s)');
  });
});
