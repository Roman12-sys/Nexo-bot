import { vi, describe, it, expect, beforeEach } from 'vitest';

// /metricas — cableado del comando. La lógica de "sacar comandos eliminados del ranking"
// (auditoría 2026-09-23) vive en getTopLiveCommands y se testea contra Supabase mockeado
// en commandUsageStore.test.js; acá solo se confirma que el comando le pasa el catálogo
// real del bot (client.commands) y arma bien la respuesta.
const isStaff = vi.fn().mockResolvedValue(true);
vi.mock('../src/utils/permissions.js', () => ({ isStaff }));

const getTopLiveCommands = vi.fn();
const getTotalUsage = vi.fn();
vi.mock('../src/utils/commandUsageStore.js', () => ({ getTopLiveCommands, getTotalUsage }));

const { execute } = await import('../src/commands/admin/metricas.js');

function makeInteraction() {
  return {
    guildId: 'guild-1',
    client: { commands: new Map([['ruleta', {}], ['setup', {}]]) },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

const row = (command_name, uses) => ({ command_name, uses });

beforeEach(() => {
  vi.clearAllMocks();
  isStaff.mockResolvedValue(true);
  getTotalUsage.mockResolvedValue(500);
});

describe('/metricas', () => {
  it('pide el top 10 filtrado con el catálogo real del bot (client.commands)', async () => {
    getTopLiveCommands.mockResolvedValue([row('ruleta', 61), row('setup', 28)]);
    const interaction = makeInteraction();

    await execute(interaction);

    expect(getTopLiveCommands).toHaveBeenCalledWith('guild-1', interaction.client.commands, 10);
    const description = interaction.editReply.mock.calls[0][0].embeds[0].data.description;
    const order = [...description.matchAll(/`\/([a-z-]+)`/g)].map((m) => m[1]);
    expect(order).toEqual(['ruleta', 'setup']);
  });

  it('sin ningún comando vivo con uso: estado vacío en vez de un ranking vacío', async () => {
    getTopLiveCommands.mockResolvedValue([]);
    const interaction = makeInteraction();

    await execute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Todavía no hay uso registrado'));
  });

  it('el total del footer sigue siendo el histórico real', async () => {
    getTopLiveCommands.mockResolvedValue([row('ruleta', 61)]);
    const interaction = makeInteraction();

    await execute(interaction);

    expect(interaction.editReply.mock.calls[0][0].embeds[0].data.footer.text).toContain('500 comandos ejecutados en total');
  });

  it('un no-staff es rechazado sin leer métricas', async () => {
    isStaff.mockResolvedValue(false);
    const interaction = makeInteraction();

    await execute(interaction);

    expect(getTopLiveCommands).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Solo el staff') }));
  });
});
