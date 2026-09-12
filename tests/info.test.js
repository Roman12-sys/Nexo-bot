import { vi, describe, it, expect } from 'vitest';
import { Collection } from 'discord.js';

// Plan de ejecución post-auditoría (2026-09-12), Fase 2 — /info cortaba la lista de
// roles a los primeros 15 con un .slice(0, 15).join(' ') mudo, sin avisar que faltó
// contenido (mismo bug class que roles.js/shop.js ya tenían arreglado). Ahora reusa
// joinWithOverflow (logEmbeds.js) — corte por longitud real del campo, con "+N más".
const { buildInfoEmbed } = await import('../src/commands/informacion/info.js');

function makeGuildAndUser({ guildId = 'guild-1', roleCount = 3 } = {}) {
  const rolesCache = new Collection();
  for (let i = 0; i < roleCount; i += 1) {
    const id = String(100000000000000000n + BigInt(i));
    rolesCache.set(id, { id, position: roleCount - i });
  }
  rolesCache.set(guildId, { id: guildId, position: 0 }); // @everyone — debe filtrarse

  const member = { roles: { cache: rolesCache }, joinedTimestamp: Date.now() };
  const guild = { id: guildId, members: { fetch: vi.fn().mockResolvedValue(member) } };
  const targetUser = {
    id: 'user-1',
    tag: 'user-1#0001',
    createdTimestamp: Date.now() - 1_000_000,
    displayAvatarURL: () => 'https://example.com/avatar.png',
  };
  return { guild, targetUser };
}

function rolesField(embed) {
  return embed.data.fields.find((f) => f.name.startsWith('🎭 Roles'));
}

describe('/info — lista de roles', () => {
  it('pocos roles: se listan todos, sin sufijo de overflow', async () => {
    const { guild, targetUser } = makeGuildAndUser({ roleCount: 3 });
    const embed = await buildInfoEmbed(guild, targetUser);

    const field = rolesField(embed);
    expect(field.name).toBe('🎭 Roles (3)');
    expect(field.value).not.toContain('más');
  });

  it('usuario sin roles: mensaje explícito, no una lista vacía muda', async () => {
    const { guild, targetUser } = makeGuildAndUser({ roleCount: 0 });
    const embed = await buildInfoEmbed(guild, targetUser);

    expect(rolesField(embed).value).toBe('Sin roles asignados');
  });

  it('muchos roles (supera los 1024 del campo): corta con "+N más" en vez de cortar en silencio', async () => {
    const { guild, targetUser } = makeGuildAndUser({ roleCount: 60 });
    const embed = await buildInfoEmbed(guild, targetUser);

    const field = rolesField(embed);
    expect(field.name).toBe('🎭 Roles (60)');
    expect(field.value.length).toBeLessThanOrEqual(1024);
    expect(field.value).toMatch(/\(\+\d+ más\)/);
  });
});
