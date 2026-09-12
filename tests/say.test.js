import { vi, describe, it, expect, beforeEach } from 'vitest';

// H4, auditoría completa NEXO (cierre en el plan de ejecución post-auditoría, Fase 4,
// 2026-09-12) — /say le pega al canal como si fuera el bot, incluido @everyone/roles/
// usuarios (allowedMentions permite las 3). Antes cualquier Tier 1 (moderador) podía
// usarlo sin fricción extra; ahora exige Tier 2 (isAdmin), mismo criterio que
// /economia-staff y /xp.
const isAdmin = vi.fn();
vi.mock('../src/utils/permissions.js', () => ({ isAdmin: (...a) => isAdmin(...a) }));

const getGuildLogChannel = vi.fn().mockResolvedValue(null);
vi.mock('../src/utils/guildLogChannels.js', () => ({ getGuildLogChannel }));

const { execute } = await import('../src/commands/diversion/say.js');

function makeInteraction({ mensaje = 'hola a todos' } = {}) {
  return {
    guildId: 'guild-1',
    client: {},
    channel: { id: 'channel-1', send: vi.fn().mockResolvedValue(undefined) },
    options: { getString: () => mensaje },
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/say — permisos (H4: Tier 2, no Tier 1)', () => {
  it('Tier 1 (moderador sin admin_role_id): rechazado, nunca llega a mandar el mensaje', async () => {
    isAdmin.mockResolvedValue(false);
    const interaction = makeInteraction();

    await execute(interaction);

    expect(interaction.channel.send).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No tenés permisos') }));
  });

  it('Tier 2 (isAdmin true): manda el mensaje con las 3 menciones permitidas', async () => {
    isAdmin.mockResolvedValue(true);
    const interaction = makeInteraction({ mensaje: 'aviso importante' });

    await execute(interaction);

    expect(interaction.channel.send).toHaveBeenCalledWith({
      content: 'aviso importante',
      allowedMentions: { parse: ['everyone', 'roles', 'users'] },
    });
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: '✅ Enviado.' }));
  });
});
