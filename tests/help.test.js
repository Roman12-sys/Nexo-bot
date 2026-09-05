import { vi, describe, it, expect } from 'vitest';

// COM-3, Fase 4B: /help debe mostrar dónde pedir ayuda con el bot SOLO si hay un
// contacto de soporte configurado (SUPPORT_CONTACT) — nunca un campo vacío ni un link
// inventado. Mismo patrón de mock de src/config.js que tests/errorReporter.test.js.
// help.js importa (transitivamente, vía info.js/servidor.js) módulos que tocan
// supabaseClient.js — el mock necesita valores dummy para el resto de config, no solo
// para supportContact, o createClient() revienta por "supabaseUrl is required".
const mockConfig = {
  discordToken: 'test-token',
  clientId: 'test-client-id',
  guildIdDev: null,
  supabaseUrl: 'https://example.supabase.co',
  supabaseServiceRoleKey: 'test-service-role-key',
  operatorAlertChannelId: null,
  supportContact: null,
};
vi.mock('../src/config.js', () => ({ config: mockConfig }));

// CICLO 1, Mejora 2/2 (experiencia del miembro) — execute()/help_back/help_roles ahora
// hacen getGuildConfig y pueden abrir el menú de roles autoasignables; se mockean los
// dos para no pegarle a Supabase/Discord real desde este archivo.
const getGuildConfig = vi.fn();
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig }));

const buildSelfRolesMessage = vi.fn();
vi.mock('../src/utils/selfRoles.js', () => ({ buildSelfRolesMessage }));

const { buildMainMenuEmbed, buildMainMenuRow, execute } = await import('../src/commands/informacion/help.js');
const { routeButton } = await import('../src/components/buttons.js');

describe('/help — contacto de soporte (COM-3)', () => {
  it('sin SUPPORT_CONTACT configurado: no agrega ningún campo de soporte', () => {
    mockConfig.supportContact = null;

    const embed = buildMainMenuEmbed();

    const fields = embed.data.fields || [];
    expect(fields.find((f) => f.name.includes('ayuda'))).toBeUndefined();
  });

  it('con SUPPORT_CONTACT configurado: muestra el contacto real, sin inventar nada', () => {
    mockConfig.supportContact = 'https://discord.gg/ejemplo-soporte';

    const embed = buildMainMenuEmbed();

    const field = embed.data.fields.find((f) => f.name.includes('ayuda'));
    expect(field).toBeDefined();
    expect(field.value).toBe('https://discord.gg/ejemplo-soporte');
  });
});

// CICLO 1, Mejora 2/2 — "🚀 Primeros pasos" se arma en base a guild_config real: nunca
// sugiere algo que este servidor no puede usar.
describe('/help — "Primeros pasos" (descubrimiento, Mejora 2/2)', () => {
  function primerosPasos(cfg) {
    return buildMainMenuEmbed(cfg).data.fields.find((f) => f.name === '🚀 Primeros pasos').value;
  }

  it('base (sin nada configurado): perfil, daily y trivia, nada más', () => {
    const value = primerosPasos({});
    expect(value).toContain('/perfil');
    expect(value).toContain('/daily');
    expect(value).toContain('/trivia jugar');
    expect(value).not.toContain('/nivel');
    expect(value).not.toContain('/report');
    expect(value).not.toContain('Mis roles');
  });

  it('con XP activado: agrega /nivel', () => {
    expect(primerosPasos({ features: { xp: true } })).toContain('/nivel');
  });

  it('sin XP: no sugiere /nivel', () => {
    expect(primerosPasos({ features: { xp: false } })).not.toContain('/nivel');
  });

  it('con destino de reportes (canal dedicado o log de moderación): agrega /report', () => {
    expect(primerosPasos({ report_channel_id: 'chan-1' })).toContain('/report');
    expect(primerosPasos({ log_channel_moderation_id: 'chan-2' })).toContain('/report');
  });

  it('sin destino de reportes: no sugiere /report', () => {
    expect(primerosPasos({})).not.toContain('/report');
  });

  it('con roles autoasignables configurados: menciona "Mis roles"', () => {
    expect(primerosPasos({ selfassignable_roles: ['role-1'] })).toContain('Mis roles');
  });
});

describe('/help — botón "Mis roles" (Mejora 2/2)', () => {
  it('buildMainMenuRow(false): una sola fila, sin el botón de roles', () => {
    const rows = buildMainMenuRow(false);
    expect(rows).toHaveLength(1);
  });

  it('buildMainMenuRow(true): segunda fila con el botón "Mis roles"', () => {
    const rows = buildMainMenuRow(true);
    expect(rows).toHaveLength(2);
    expect(rows[1].components[0].data.custom_id).toBe('help_roles');
  });

  it('execute(): el botón solo aparece si el server tiene roles autoasignables configurados', async () => {
    getGuildConfig.mockResolvedValue({ selfassignable_roles: ['role-1'] });
    const interaction = { guildId: 'guild-1', reply: vi.fn().mockResolvedValue(undefined) };

    await execute(interaction);

    const payload = interaction.reply.mock.calls[0][0];
    expect(payload.components).toHaveLength(2);
  });

  it('execute(): sin roles configurados, no se agrega la segunda fila', async () => {
    getGuildConfig.mockResolvedValue({ selfassignable_roles: [] });
    const interaction = { guildId: 'guild-1', reply: vi.fn().mockResolvedValue(undefined) };

    await execute(interaction);

    const payload = interaction.reply.mock.calls[0][0];
    expect(payload.components).toHaveLength(1);
  });

  it('help_roles: sin roles disponibles, avisa en vez de abrir un menú vacío', async () => {
    buildSelfRolesMessage.mockResolvedValue(null);
    const interaction = { customId: 'help_roles', guild: {}, member: {}, reply: vi.fn().mockResolvedValue(undefined) };

    await routeButton(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('todavía no tiene') }));
  });

  it('help_roles: con roles disponibles, reabre el mismo menú (ephemeral)', async () => {
    buildSelfRolesMessage.mockResolvedValue({ content: 'Elegí tus roles', components: ['fake-row'] });
    const interaction = { customId: 'help_roles', guild: {}, member: {}, reply: vi.fn().mockResolvedValue(undefined) };

    await routeButton(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'Elegí tus roles', components: ['fake-row'], flags: expect.any(Number) }));
  });
});
