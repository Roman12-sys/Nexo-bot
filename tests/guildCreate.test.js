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

// 2026-09-27: Cloud6 instaló NEXO con todos sus canales ocultos para @everyone — el bot
// no veía nada y nadie se enteró. El mensaje de bienvenida es el único que NEXO manda
// solo, así que el aviso va ahí; y si el canal de sistema no acepta el mensaje, va por
// MD al dueño (antes se perdía).
describe('guildCreate — instalación sin acceso a los canales', () => {
  const blind = { type: 0, permissionsFor: () => ({ has: () => false }) };

  it('bot ciego: el mensaje de bienvenida suma el aviso con la cantidad de canales', async () => {
    const guild = { ...makeGuild(), members: { me: {} }, channels: { cache: new Map([['a', blind], ['b', blind], ['c', blind]]) } };

    await execute(guild);

    const [{ embeds }] = guild.systemChannel.send.mock.calls[0];
    const field = embeds[0].data.fields?.find((f) => f.name.includes('no veo tus canales'));
    expect(field?.value).toMatch(/ninguno de los 3/);
  });

  it('si el canal de sistema rechaza el mensaje, se lo manda por MD al dueño', async () => {
    const guild = makeGuild();
    guild.systemChannel.send.mockRejectedValueOnce(new Error('Missing Access'));
    const ownerSend = vi.fn().mockResolvedValue(undefined);
    guild.fetchOwner.mockResolvedValue({ user: { send: ownerSend } });

    await execute(guild);

    expect(ownerSend).toHaveBeenCalledTimes(1);
  });

  it('si el canal de sistema lo acepta, no molesta al dueño por MD', async () => {
    const guild = makeGuild();

    await execute(guild);

    expect(guild.systemChannel.send).toHaveBeenCalledTimes(1);
    expect(guild.fetchOwner).not.toHaveBeenCalled();
  });

  it('sin canal de sistema: va directo por MD al dueño', async () => {
    const guild = makeGuild({ hasSystemChannel: false });
    const ownerSend = vi.fn().mockResolvedValue(undefined);
    guild.fetchOwner.mockResolvedValue({ user: { send: ownerSend } });

    await execute(guild);

    expect(ownerSend).toHaveBeenCalledTimes(1);
  });
});
