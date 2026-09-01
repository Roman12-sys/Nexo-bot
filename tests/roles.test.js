import { vi, describe, it, expect } from 'vitest';
import { Collection } from 'discord.js';

// /roles tenía el mismo bug que sanciones_punish (ver sanctions.test.js): pedía todos
// los miembros vía guild.members.fetch() (gateway, opcode 8), sujeto al rate limit
// aparte de Discord para ese mecanismo. Acá solo importa confirmar que el comando ya no
// llama a ese fetch — la paginación en sí (fetchAllMembers) ya tiene su propia batería
// completa en sanctions.test.js, no hace falta repetirla acá.
const isStaff = vi.fn().mockResolvedValue(true);
vi.mock('../src/utils/permissions.js', () => ({ isStaff }));

const { execute: rolesExecute } = await import('../src/commands/informacion/roles.js');

describe('/roles', () => {
  it('usa guild.members.list (REST paginado) en vez de guild.members.fetch (gateway)', async () => {
    const membersFetch = vi.fn();
    const membersList = vi.fn().mockResolvedValue(new Collection());
    const interaction = {
      guild: {
        id: 'guild-1',
        name: 'Server de prueba',
        memberCount: 0,
        roles: { cache: new Collection() },
        members: { fetch: membersFetch, list: membersList },
      },
      member: { roles: { cache: new Map() } },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    };

    await rolesExecute(interaction);

    expect(membersFetch).not.toHaveBeenCalled();
    expect(membersList).toHaveBeenCalledWith({ limit: 1000, after: undefined });
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
  });

  it('sin permisos: no llega a pedir miembros', async () => {
    isStaff.mockResolvedValueOnce(false);
    const membersList = vi.fn();
    const interaction = {
      guild: { members: { list: membersList } },
      reply: vi.fn().mockResolvedValue(undefined),
    };

    await rolesExecute(interaction);

    expect(membersList).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('permisos') }));
  });
});
