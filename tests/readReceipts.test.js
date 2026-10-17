import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Collection } from 'discord.js';

const fetchAllMembers = vi.fn();
vi.mock('../src/utils/sanctions.js', () => ({ fetchAllMembers: (...a) => fetchAllMembers(...a) }));

const { routeButton } = await import('../src/components/buttons.js');
const { buildReadReceiptMessage, parseReadIds, READ_BUTTON_ID, UNREAD_BUTTON_ID } = await import('../src/utils/readReceipts.js');

function member(id, { bot = false, canView = true } = {}) {
  return { id, user: { bot }, canView };
}

function makeInteraction(customId, userId, readIds, members) {
  let current = buildReadReceiptMessage(readIds, []).embeds[0].toJSON();
  fetchAllMembers.mockResolvedValue(new Collection(members.map((m) => [m.id, m])));
  const interaction = {
    customId,
    user: { id: userId },
    channel: { guild: {}, permissionsFor: (m) => ({ has: () => m.canView }) },
    message: { id: 'msg-1', fetch: vi.fn(async () => ({ embeds: [current] })) },
    deferUpdate: vi.fn(async () => {}),
    editReply: vi.fn(async (payload) => { current = payload.embeds[0].toJSON(); }),
    followUp: vi.fn(async () => {}),
  };
  return { interaction, latest: () => current };
}

describe('readReceipts', () => {
  beforeEach(() => fetchAllMembers.mockReset());

  it('parseReadIds ignora menciones fuera de la lista de leídas', () => {
    expect(parseReadIds({ description: 'Hola <@9>\n\n**✅ Leídas (2)**\n<@1> <@2>' })).toEqual(['1', '2']);
    expect(parseReadIds({ description: 'sin lista' })).toEqual([]);
    expect(parseReadIds(undefined)).toEqual([]);
  });

  it('marcar leídas agrega al usuario y recalcula sin leer (sin bots ni quien no ve el canal)', async () => {
    const members = [member('1'), member('2'), member('3', { bot: true }), member('4', { canView: false })];
    const { interaction, latest } = makeInteraction(READ_BUTTON_ID, '2', ['1'], members);
    expect(await routeButton(interaction)).toBe(true);
    const embed = latest();
    expect(parseReadIds(embed)).toEqual(['1', '2']);
    expect(embed.fields[0].name).toBe('⏳ Sin leer (0)');
    expect(interaction.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('leíste') }));
  });

  it('marcar dos veces no duplica', async () => {
    const { interaction, latest } = makeInteraction(READ_BUTTON_ID, '1', ['1'], [member('1')]);
    await routeButton(interaction);
    expect(parseReadIds(latest())).toEqual(['1']);
  });

  it('no leídas saca al usuario y lo pasa a sin leer', async () => {
    const { interaction, latest } = makeInteraction(UNREAD_BUTTON_ID, '1', ['1', '2'], [member('1'), member('2')]);
    await routeButton(interaction);
    const embed = latest();
    expect(parseReadIds(embed)).toEqual(['2']);
    expect(embed.fields[0].name).toBe('⏳ Sin leer (1)');
    expect(embed.fields[0].value).toContain('<@1>');
  });

  it('el mensaje nunca menciona de verdad a nadie', () => {
    expect(buildReadReceiptMessage(['1'], ['2']).allowedMentions).toEqual({ parse: [] });
  });
});
