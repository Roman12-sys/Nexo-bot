import { vi, describe, it, expect } from 'vitest';

// permissions.js importa guildConfigStore.js, que a su vez importa supabaseClient.js
// (requiere variables de entorno reales). Se mockea para testear la lógica pura de
// jerarquía de getModerationBlockReason() sin necesitar credenciales de Supabase.
vi.mock('../src/supabaseClient.js', () => ({ supabase: {} }));

const { getModerationBlockReason } = await import('../src/utils/permissions.js');

function makeInteraction({ userId = 'mod-1', botId = 'bot-1', ownerId = 'owner-1', modPosition = 10 } = {}) {
  return {
    user: { id: userId },
    client: { user: { id: botId } },
    guild: { ownerId },
    member: { roles: { highest: { position: modPosition } } },
  };
}

function makeMember(id, position) {
  return { id, roles: { highest: { position } } };
}

describe('getModerationBlockReason', () => {
  it('sin target, no bloquea (null)', () => {
    expect(getModerationBlockReason(makeInteraction(), null)).toBeNull();
  });

  it('no podés aplicar una acción sobre vos mismo', () => {
    const interaction = makeInteraction({ userId: 'mod-1' });
    const target = makeMember('mod-1', 5);
    expect(getModerationBlockReason(interaction, target)).toMatch(/vos mismo/);
  });

  it('no podés aplicar una acción sobre el bot', () => {
    const interaction = makeInteraction({ botId: 'bot-1' });
    const target = makeMember('bot-1', 5);
    expect(getModerationBlockReason(interaction, target)).toMatch(/el bot/);
  });

  it('bloquea actuar sobre alguien de rango igual o superior', () => {
    const interaction = makeInteraction({ modPosition: 5 });
    const target = makeMember('other', 5); // mismo rango
    expect(getModerationBlockReason(interaction, target)).toMatch(/rango/);

    const higherTarget = makeMember('other', 8); // rango superior
    expect(getModerationBlockReason(interaction, higherTarget)).toMatch(/rango/);
  });

  it('permite actuar sobre alguien de rango inferior', () => {
    const interaction = makeInteraction({ modPosition: 10 });
    const target = makeMember('other', 3);
    expect(getModerationBlockReason(interaction, target)).toBeNull();
  });

  it('el dueño del servidor puede actuar sobre cualquiera, incluso rango igual/superior', () => {
    const interaction = makeInteraction({ userId: 'owner-1', ownerId: 'owner-1', modPosition: 1 });
    const target = makeMember('other', 99);
    expect(getModerationBlockReason(interaction, target)).toBeNull();
  });
});
