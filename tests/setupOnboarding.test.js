import { vi, describe, it, expect, beforeEach } from 'vitest';

// Fase 4C-1 — onboarding posterior a /setup: título "✅ NEXO está listo", campo "🚀
// Próximos pasos" (condicional a lo que quedó realmente activado), link al dashboard
// (solo si config.dashboardUrl está seteado — nunca una URL inventada) y aviso de
// permisos faltantes (reusa getMissingBotPermissions, mismo criterio que /estado).
const getGuildConfig = vi.fn();
const setGuildConfig = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig, setGuildConfig }));

const getGuildLogChannel = vi.fn().mockResolvedValue(null);
vi.mock('../src/utils/guildLogChannels.js', () => ({ getGuildLogChannel }));

const mockConfig = { dashboardUrl: null };
vi.mock('../src/config.js', () => ({ config: mockConfig }));

await import('../src/commands/admin/setup.js'); // side effect: registra los handlers de botón
const { routeButton } = await import('../src/components/buttons.js');

function makeGuildRoleRegistry() {
  let counter = 1;
  const byId = new Map();
  return {
    cache: { find: () => undefined },
    fetch: vi.fn(async (id) => byId.get(id) || null),
    create: vi.fn(async ({ name }) => {
      const role = { id: `role-nuevo-${counter++}`, name, toString() { return `<@&${this.id}>`; }, permissions: { has: () => false } };
      byId.set(role.id, role);
      return role;
    }),
    everyone: { id: 'role-everyone' },
  };
}

function makeChannelRegistry() {
  let counter = 1;
  return {
    cache: { find: () => undefined },
    fetch: vi.fn(async () => null),
    create: vi.fn(async ({ name }) => ({ id: `chan-nuevo-${counter++}`, name, toString() { return `<#${this.id}>`; } })),
  };
}

function makeInteraction({ botPermissionsGranted = true, guildId = 'guild-1' } = {}) {
  return {
    guild: {
      id: guildId,
      ownerId: 'admin-1',
      roles: makeGuildRoleRegistry(),
      channels: makeChannelRegistry(),
      members: { me: { permissions: { has: () => botPermissionsGranted } } },
    },
    guildId,
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

async function runSetupFlow(interaction, { template = 'personalizado', extras = [] } = {}) {
  await routeButton(makeFollowUp(interaction, `setup_template_${template}`));
  for (const stateKey of extras) {
    await routeButton(makeFollowUp(interaction, `setup_toggle_${stateKey}`));
  }
  const confirmInteraction = makeFollowUp(interaction, 'setup_confirm');
  await routeButton(confirmInteraction);
  return confirmInteraction;
}

function finalEmbed(confirmInteraction) {
  return confirmInteraction.editReply.mock.calls.at(-1)?.[0]?.embeds?.[0];
}

function fieldValue(embed, name) {
  return embed?.data?.fields?.find((f) => f.name === name)?.value;
}

beforeEach(() => {
  vi.clearAllMocks();
  getGuildConfig.mockResolvedValue({});
  getGuildLogChannel.mockResolvedValue(null);
  mockConfig.dashboardUrl = null;
});

describe('/setup — onboarding final: título', () => {
  it('el título del embed final es "✅ NEXO está listo"', async () => {
    const interaction = makeInteraction();
    const confirm = await runSetupFlow(interaction);

    expect(finalEmbed(confirm).data.title).toBe('✅ NEXO está listo');
  });
});

describe('/setup — onboarding final: "🚀 Próximos pasos"', () => {
  it('siempre incluye /help y /daily (economía siempre activa)', async () => {
    const interaction = makeInteraction();
    const confirm = await runSetupFlow(interaction, { template: 'personalizado' });

    const steps = fieldValue(finalEmbed(confirm), '🚀 Próximos pasos');
    expect(steps).toContain('/help');
    expect(steps).toContain('/daily');
  });

  it('con XP activado: sugiere /nivel', async () => {
    const interaction = makeInteraction();
    const confirm = await runSetupFlow(interaction, { template: 'comunidad' }); // moderacion+xp activados

    const steps = fieldValue(finalEmbed(confirm), '🚀 Próximos pasos');
    expect(steps).toContain('/nivel');
  });

  it('sin XP: no sugiere /nivel (no tiene sentido recomendar algo que se dejó apagado)', async () => {
    const interaction = makeInteraction();
    const confirm = await runSetupFlow(interaction, { template: 'personalizado' }); // moderacion+xp apagados

    const steps = fieldValue(finalEmbed(confirm), '🚀 Próximos pasos');
    expect(steps).not.toContain('/nivel');
  });

  it('con moderación activada: sugiere /report', async () => {
    const interaction = makeInteraction();
    const confirm = await runSetupFlow(interaction, { template: 'comunidad' });

    const steps = fieldValue(finalEmbed(confirm), '🚀 Próximos pasos');
    expect(steps).toContain('/report');
  });

  it('sin moderación NI extra de reportes: no sugiere /report (no tendría a dónde llegar)', async () => {
    const interaction = makeInteraction();
    const confirm = await runSetupFlow(interaction, { template: 'personalizado' });

    const steps = fieldValue(finalEmbed(confirm), '🚀 Próximos pasos');
    expect(steps).not.toContain('/report');
  });

  it('sin moderación pero CON el extra "Canal de reportes": igual sugiere /report', async () => {
    const interaction = makeInteraction();
    const confirm = await runSetupFlow(interaction, { template: 'personalizado', extras: ['reportes'] });

    const steps = fieldValue(finalEmbed(confirm), '🚀 Próximos pasos');
    expect(steps).toContain('/report');
  });

  it('con DASHBOARD_BASE_URL configurado: incluye el link real al panel de este servidor', async () => {
    mockConfig.dashboardUrl = 'https://panel.example.com';
    const interaction = makeInteraction({ guildId: 'guild-42' });
    const confirm = await runSetupFlow(interaction, { template: 'personalizado' });

    const steps = fieldValue(finalEmbed(confirm), '🚀 Próximos pasos');
    expect(steps).toContain('https://panel.example.com/guild/guild-42');
  });

  it('sin DASHBOARD_BASE_URL configurado: nunca inventa un link al dashboard', async () => {
    mockConfig.dashboardUrl = null;
    const interaction = makeInteraction();
    const confirm = await runSetupFlow(interaction, { template: 'personalizado' });

    const steps = fieldValue(finalEmbed(confirm), '🚀 Próximos pasos');
    expect(steps).not.toMatch(/https?:\/\//);
  });
});

describe('/setup — extra "Canal de reportes" (nuevo, Fase 4C-1)', () => {
  it('activado: crea el canal y persiste report_channel_id', async () => {
    const interaction = makeInteraction();

    await runSetupFlow(interaction, { template: 'personalizado', extras: ['reportes'] });

    const call = setGuildConfig.mock.calls.find((c) => 'report_channel_id' in c[1]);
    expect(call).toBeDefined();
    expect(call[1].report_channel_id).toMatch(/^chan-nuevo-/);
  });

  it('no activado: report_channel_id nunca se toca', async () => {
    const interaction = makeInteraction();

    await runSetupFlow(interaction, { template: 'personalizado', extras: [] });

    expect(setGuildConfig.mock.calls.some((c) => 'report_channel_id' in c[1])).toBe(false);
  });
});

describe('/setup — onboarding final: "⚠️ Permisos faltantes"', () => {
  it('con todos los permisos esenciales concedidos: no agrega ningún aviso', async () => {
    const interaction = makeInteraction({ botPermissionsGranted: true });
    const confirm = await runSetupFlow(interaction, { template: 'personalizado' });

    expect(fieldValue(finalEmbed(confirm), '⚠️ Permisos faltantes')).toBeUndefined();
  });

  it('con permisos esenciales faltantes: avisa qué falta y qué función afecta', async () => {
    const interaction = makeInteraction({ botPermissionsGranted: false });
    const confirm = await runSetupFlow(interaction, { template: 'personalizado' });

    const warning = fieldValue(finalEmbed(confirm), '⚠️ Permisos faltantes');
    expect(warning).toBeDefined();
    expect(warning).toMatch(/afecta:/);
  });
});
