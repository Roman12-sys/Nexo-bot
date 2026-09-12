import { vi, describe, it, expect, beforeEach } from 'vitest';

// Plan de ejecución post-auditoría, Fase 5 (2026-09-12) — guildCreate.js suma el
// registro del evento 'join' (observabilidad de negocio, ver botGuildEventsStore.js),
// best-effort: nunca debe impedir el mensaje de bienvenida si falla.
const recordGuildEvent = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/botGuildEventsStore.js', () => ({ recordGuildEvent: (...a) => recordGuildEvent(...a) }));

const { execute } = await import('../src/events/guildCreate.js');

function makeGuild({ id = 'guild-1', hasSystemChannel = true, ownerSendFails = false } = {}) {
  return {
    id,
    systemChannel: hasSystemChannel ? { send: vi.fn().mockResolvedValue(undefined) } : null,
    fetchOwner: vi.fn().mockResolvedValue(
      ownerSendFails ? null : { user: { send: vi.fn().mockResolvedValue(undefined) } },
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('guildCreate — registro del evento "join" (observabilidad, Fase 5)', () => {
  it('registra el join con el guild_id real', async () => {
    const guild = makeGuild({ id: 'guild-nuevo' });

    await execute(guild);

    expect(recordGuildEvent).toHaveBeenCalledWith('guild-nuevo', 'join');
  });

  it('si recordGuildEvent falla, el mensaje de bienvenida se manda igual', async () => {
    recordGuildEvent.mockRejectedValueOnce(new Error('boom'));
    const guild = makeGuild();

    await expect(execute(guild)).resolves.toBeUndefined();
    expect(guild.systemChannel.send).toHaveBeenCalled();
  });
});
