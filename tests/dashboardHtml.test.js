import { vi, describe, it, expect } from 'vitest';

// dashboard/html.js — DASH-1, Fase 4B: layout() gana un link de invite (siempre visible,
// construido con el client_id real — nada inventado) y un footer de soporte (COM-3, solo
// si config.supportContact está configurado). Se mockea src/config.js con valores dummy
// completos, mismo criterio que tests/help.test.js.
const mockConfig = {
  discordToken: 'test-token',
  clientId: '1234567890123456789',
  guildIdDev: null,
  supabaseUrl: 'https://example.supabase.co',
  supabaseServiceRoleKey: 'test-service-role-key',
  operatorAlertChannelId: null,
  supportContact: null,
};
vi.mock('../src/config.js', () => ({ config: mockConfig }));

const { layout } = await import('../dashboard/html.js');
const { essentialPermissionsBitfield } = await import('../src/utils/botPermissions.js');

describe('dashboard layout() — invite link (DASH-1)', () => {
  it('siempre incluye un link de invite con el client_id real del proyecto', () => {
    const html = layout({ title: 'Test', body: '<p>hola</p>' });

    expect(html).toContain('https://discord.com/oauth2/authorize?client_id=1234567890123456789&scope=bot+applications.commands');
  });

  // Fase 4C-1 (guía de permisos): el link ahora pre-tilda los permisos esenciales del
  // bot — se compara contra la MISMA función que arma el bitfield, no un número mágico
  // copiado a mano (que se desincroniza en silencio si ESSENTIAL_BOT_PERMISSIONS cambia).
  it('incluye el bitfield de permisos esenciales calculado por botPermissions.js', () => {
    const html = layout({ title: 'Test', body: '<p>hola</p>' });

    expect(html).toContain(`&permissions=${essentialPermissionsBitfield()}`);
  });
});

describe('dashboard layout() — contacto de soporte (COM-3)', () => {
  it('sin SUPPORT_CONTACT configurado: no muestra ningún footer de soporte', () => {
    mockConfig.supportContact = null;

    const html = layout({ title: 'Test', body: '<p>hola</p>' });

    expect(html).not.toContain('¿Problemas con el bot?');
  });

  it('con SUPPORT_CONTACT configurado: lo muestra en el footer, escapado', () => {
    mockConfig.supportContact = 'https://discord.gg/ejemplo-soporte';

    const html = layout({ title: 'Test', body: '<p>hola</p>' });

    expect(html).toContain('¿Problemas con el bot?');
    expect(html).toContain('https://discord.gg/ejemplo-soporte');
  });
});
