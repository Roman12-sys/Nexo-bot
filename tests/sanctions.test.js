import { describe, it, expect, vi } from 'vitest';
import { Collection } from 'discord.js';
import { fetchAllMembers, getActiveTimeouts, getPunishedMembers, getBannedUsers } from '../src/utils/sanctions.js';

// sanctions.js — bug real en producción, 2026-09-01: guild.members.fetch() (sin
// argumentos) manda la lista completa de miembros por el GATEWAY (opcode 8,
// RequestGuildMembers), que Discord rate-limitea aparte del rate limit normal de REST —
// sanciones_punish reventó con GatewayRateLimitError (retry_after ~28s). Reemplazado por
// un loop paginado sobre guild.members.list() (REST puro). Lo que más importa probar acá
// es la paginación en sí (que no se corte antes de tiempo, que no repita página, que
// termine) — el resto de la lógica de filtrado no cambió.
function makeGuildWithMembers(count, { withRole = null, withTimeout = null } = {}) {
  const members = Array.from({ length: count }, (_, i) => {
    const id = String(1000 + i).padStart(20, '0'); // ordenable como un snowflake real
    return [
      id,
      {
        id,
        roles: { cache: new Map(withRole === i ? [[withRole.roleId, {}]] : []) },
        communicationDisabledUntilTimestamp: withTimeout === i ? withTimeout.until : null,
      },
    ];
  });

  const list = vi.fn(async ({ limit, after }) => {
    const startIndex = after ? members.findIndex(([id]) => id === after) + 1 : 0;
    return new Collection(members.slice(startIndex, startIndex + limit));
  });

  return { members: { list } };
}

describe('fetchAllMembers', () => {
  it('una sola página (<1000): la trae completa sin llamadas de más', async () => {
    const guild = makeGuildWithMembers(50);
    const all = await fetchAllMembers(guild);

    expect(all.size).toBe(50);
    expect(guild.members.list).toHaveBeenCalledTimes(1);
    expect(guild.members.list).toHaveBeenCalledWith({ limit: 1000, after: undefined });
  });

  it('más de 1000 miembros: pagina con `after` hasta traerlos todos, sin duplicar ni perder ninguno', async () => {
    const guild = makeGuildWithMembers(1500);
    const all = await fetchAllMembers(guild);

    expect(all.size).toBe(1500);
    expect(guild.members.list).toHaveBeenCalledTimes(2);
  });

  it('exactamente 1000 miembros: una página llena más una vacía que confirma el final', async () => {
    const guild = makeGuildWithMembers(1000);
    const all = await fetchAllMembers(guild);

    expect(all.size).toBe(1000);
    expect(guild.members.list).toHaveBeenCalledTimes(2);
  });

  it('guild sin miembros aparte del bot: no revienta, devuelve vacío', async () => {
    const guild = makeGuildWithMembers(0);
    const all = await fetchAllMembers(guild);

    expect(all.size).toBe(0);
    expect(guild.members.list).toHaveBeenCalledTimes(1);
  });
});

describe('getActiveTimeouts', () => {
  it('filtra solo a quienes tienen timeout activo (fecha futura) — no vencidos ni sin timeout', async () => {
    const now = Date.now();
    const guild = {
      members: {
        list: vi.fn(async () =>
          new Collection([
            ['activo', { id: 'activo', communicationDisabledUntilTimestamp: now + 60_000 }],
            ['vencido', { id: 'vencido', communicationDisabledUntilTimestamp: now - 60_000 }],
            ['nunca', { id: 'nunca', communicationDisabledUntilTimestamp: null }],
          ]),
        ),
      },
    };

    const result = await getActiveTimeouts(guild);

    expect([...result.keys()]).toEqual(['activo']);
  });
});

describe('getPunishedMembers', () => {
  it('filtra solo a quienes tienen el rol de sanción configurado', async () => {
    const guild = {
      members: {
        list: vi.fn(async () =>
          new Collection([
            ['sancionado', { id: 'sancionado', roles: { cache: new Map([['role-sancionado', {}]]) } }],
            ['normal', { id: 'normal', roles: { cache: new Map() } }],
          ]),
        ),
      },
    };

    const result = await getPunishedMembers(guild, 'role-sancionado');

    expect([...result.keys()]).toEqual(['sancionado']);
  });
});

describe('getBannedUsers', () => {
  it('sigue pidiendo la lista directo a Discord (guild.bans.fetch), sin tocar', async () => {
    const bans = new Collection([['user-1', {}]]);
    const guild = { bans: { fetch: vi.fn().mockResolvedValue(bans) } };

    const result = await getBannedUsers(guild);

    expect(result).toBe(bans);
    expect(guild.bans.fetch).toHaveBeenCalledTimes(1);
  });
});
