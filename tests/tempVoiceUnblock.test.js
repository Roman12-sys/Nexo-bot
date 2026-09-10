import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PermissionFlagsBits, OverwriteType } from 'discord.js';

// handleUnblockButton (auditoría Ciclo 1, hallazgo Medio) — antes resolvía los IDs
// bloqueados SOLO contra guild.members.cache, sin ningún fallback. El caché de miembros
// arranca vacío en cada boot (Railway redeploya en cada push a main); si alguien quedaba
// bloqueado y no volvía a aparecer en caché antes del próximo redeploy, el dueño de la
// sala veía "nadie bloqueado" aunque el overwrite de Discord lo siguiera bloqueando de
// verdad. Fix: fetch puntual POR ID (nunca guild.members.fetch() sin argumentos) para
// lo que el caché no tiene.
const getTempChannelByChannelId = vi.fn();
vi.mock('../src/utils/tempVoiceStore.js', () => ({
  createTempChannel: vi.fn(),
  getTempChannelByChannelId: (...a) => getTempChannelByChannelId(...a),
  getTempChannelByOwner: vi.fn(),
  updateTempChannel: vi.fn(),
  deleteTempChannel: vi.fn().mockResolvedValue(undefined),
  transferTempChannelOwner: vi.fn(),
  getAllTempChannels: vi.fn(),
  recordChannelStats: vi.fn(),
  getGuildVoiceStatsSummary: vi.fn(),
}));

vi.mock('../src/utils/voiceConfigStore.js', () => ({
  getGuildVoiceConfig: vi.fn(),
  upsertGuildVoiceConfig: vi.fn(),
  disableGuildVoiceConfig: vi.fn(),
}));

const { handleUnblockButton } = await import('../src/utils/tempVoiceEngine.js');

function makeOverwrite(id) {
  return {
    type: OverwriteType.Member,
    id,
    deny: { has: (flag) => flag === PermissionFlagsBits.Connect },
  };
}

function makeMember(id, tag) {
  return { id, user: { id, tag } };
}

function makeInteraction({ guildId = 'guild-1', ownerId = 'owner-1', overwrites = [], cachedMembers = [], fetchImpl } = {}) {
  const overwritesCache = new Map(overwrites.map((ow) => [ow.id, ow]));
  const membersCache = new Map(cachedMembers.map((m) => [m.id, m]));

  const channel = {
    permissionOverwrites: { cache: overwritesCache },
    guild: {
      id: guildId,
      members: {
        cache: membersCache,
        fetch: fetchImpl || vi.fn().mockResolvedValue(null),
      },
    },
  };

  return {
    guild: { id: guildId, channels: { fetch: vi.fn().mockResolvedValue(channel) } },
    user: { id: ownerId },
    reply: vi.fn().mockResolvedValue(undefined),
    _channel: channel,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getTempChannelByChannelId.mockResolvedValue({ ownerId: 'owner-1' });
});

describe('handleUnblockButton — resolución de bloqueados', () => {
  it('bloqueado presente en caché: se ofrece directo, sin ningún fetch', async () => {
    const interaction = makeInteraction({
      overwrites: [makeOverwrite('blocked-1')],
      cachedMembers: [makeMember('blocked-1', 'blocked-1#0001')],
    });

    await handleUnblockButton(interaction, 'chan-1');

    expect(interaction._channel.guild.members.fetch).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Elegí a quién desbloquear') }));
  });

  it('bloqueado AUSENTE del caché (ej. tras un redeploy): se resuelve con fetch puntual por ID, sigue apareciendo', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeMember('blocked-2', 'blocked-2#0001'));
    const interaction = makeInteraction({
      overwrites: [makeOverwrite('blocked-2')],
      cachedMembers: [], // caché vacío, como recién después de un boot
      fetchImpl,
    });

    await handleUnblockButton(interaction, 'chan-1');

    expect(fetchImpl).toHaveBeenCalledWith('blocked-2');
    expect(fetchImpl).not.toHaveBeenCalledWith(); // nunca fetch() sin argumentos
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Elegí a quién desbloquear') }));
  });

  it('fetch falla (usuario ya no está en el servidor): se descarta sin reventar', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('Unknown Member'));
    const interaction = makeInteraction({
      overwrites: [makeOverwrite('blocked-gone')],
      cachedMembers: [],
      fetchImpl,
    });

    await expect(handleUnblockButton(interaction, 'chan-1')).resolves.not.toThrow();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No hay nadie bloqueado') }));
  });

  it('mezcla: uno en caché + uno que necesita fetch → los dos terminan disponibles en el select', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeMember('blocked-fetched', 'fetched#0001'));
    const interaction = makeInteraction({
      overwrites: [makeOverwrite('blocked-cached'), makeOverwrite('blocked-fetched')],
      cachedMembers: [makeMember('blocked-cached', 'cached#0001')],
      fetchImpl,
    });

    await handleUnblockButton(interaction, 'chan-1');

    expect(fetchImpl).toHaveBeenCalledWith('blocked-fetched');
    expect(fetchImpl).not.toHaveBeenCalledWith('blocked-cached');
    const select = interaction.reply.mock.calls[0][0].components[0].components[0];
    const values = select.toJSON().options.map((o) => o.value).sort();
    expect(values).toEqual(['blocked-cached', 'blocked-fetched']);
  });

  it('dos salas de guilds distintas: el fetch de una nunca toca el members manager de la otra', async () => {
    const fetchA = vi.fn().mockResolvedValue(makeMember('blocked-a', 'a#0001'));
    const fetchB = vi.fn().mockResolvedValue(makeMember('blocked-b', 'b#0001'));
    const interactionA = makeInteraction({ guildId: 'guild-a', overwrites: [makeOverwrite('blocked-a')], fetchImpl: fetchA });
    const interactionB = makeInteraction({ guildId: 'guild-b', overwrites: [makeOverwrite('blocked-b')], fetchImpl: fetchB });

    await handleUnblockButton(interactionA, 'chan-a');
    await handleUnblockButton(interactionB, 'chan-b');

    expect(fetchA).toHaveBeenCalledWith('blocked-a');
    expect(fetchA).not.toHaveBeenCalledWith('blocked-b');
    expect(fetchB).toHaveBeenCalledWith('blocked-b');
    expect(fetchB).not.toHaveBeenCalledWith('blocked-a');
  });
});
