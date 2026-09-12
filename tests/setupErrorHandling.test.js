import { vi, describe, it, expect } from 'vitest';

// H10, auditoría completa NEXO (cierre en el plan de ejecución post-auditoría, Fase 4,
// 2026-09-12) — setup_confirm crea canales/roles reales; si al bot le falta un permiso
// justo en ese paso (ej. alguien le sacó Gestionar roles después de invitarlo), el
// admin instalando el bot por primera vez se merece saber QUÉ pasó vía describeError,
// no el genérico "Ocurrió un error configurando el servidor. Probá de nuevo." de antes.
const getGuildConfig = vi.fn().mockResolvedValue({});
const setGuildConfig = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig, setGuildConfig }));

const getGuildLogChannel = vi.fn().mockResolvedValue(null);
vi.mock('../src/utils/guildLogChannels.js', () => ({ getGuildLogChannel }));

vi.mock('../src/config.js', () => ({ config: { dashboardUrl: null } }));

await import('../src/commands/admin/setup.js');
const { routeButton } = await import('../src/components/buttons.js');

function makeFailingRoleRegistry(error) {
  return {
    cache: { find: () => undefined },
    fetch: vi.fn(async () => null),
    create: vi.fn(async () => { throw error; }),
    everyone: { id: 'role-everyone' },
  };
}

function makeChannelRegistry() {
  let counter = 1;
  return {
    cache: { find: () => undefined },
    fetch: vi.fn(async () => null),
    create: vi.fn(async ({ name }) => ({ id: `chan-${counter++}`, name, toString() { return `<#${this.id}>`; } })),
  };
}

function makeInteraction({ roleError }) {
  const guild = {
    id: 'guild-1',
    ownerId: 'admin-1',
    roles: makeFailingRoleRegistry(roleError),
    channels: makeChannelRegistry(),
    members: { me: { permissions: { has: () => true } } },
  };
  return {
    guild,
    guildId: 'guild-1',
    user: { id: 'admin-1', tag: 'admin#0001' },
    member: { permissions: { has: () => true } },
    client: {},
    reply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

function makeFollowUp(base, customId) {
  return { ...base, customId, update: vi.fn().mockResolvedValue(undefined), reply: vi.fn().mockResolvedValue(undefined) };
}

describe('setup_confirm — errores reales de Discord traducidos (H10)', () => {
  it('al bot le falta un permiso creando un rol (50013): mensaje específico, no el genérico', async () => {
    const interaction = makeInteraction({ roleError: { code: 50013, message: 'Missing Permissions' } });

    await routeButton(makeFollowUp(interaction, 'setup_template_personalizado'));
    const confirmInteraction = makeFollowUp(interaction, 'setup_confirm');
    await routeButton(confirmInteraction);

    expect(confirmInteraction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('le falta un permiso de Discord') }),
    );
  });

  it('error sin código conocido: cae al mensaje genérico de siempre', async () => {
    const interaction = makeInteraction({ roleError: new Error('algo random') });

    await routeButton(makeFollowUp(interaction, 'setup_template_personalizado'));
    const confirmInteraction = makeFollowUp(interaction, 'setup_confirm');
    await routeButton(confirmInteraction);

    expect(confirmInteraction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: '❌ Ocurrió un error configurando el servidor. Probá de nuevo.' }),
    );
  });
});
