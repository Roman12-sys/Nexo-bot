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

const { buildMainMenuEmbed } = await import('../src/commands/informacion/help.js');

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
