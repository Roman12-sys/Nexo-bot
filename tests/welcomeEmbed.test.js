import { describe, it, expect } from 'vitest';
import {
  buildWelcomeEmbed,
  buildWelcomePreviewEmbed,
  contextFromMember,
  contextFromInteraction,
  isCustomWelcomeConfigured,
  DEFAULT_WELCOME_TITLE,
  DEFAULT_WELCOME_DESCRIPTION,
} from '../src/utils/welcomeEmbed.js';

// NEXO Setup Inteligente, Bloque 11-12 — reemplaza el embed de bienvenida basado en
// imagen (welcomeImage.js). El trailer de /help es la pieza más delicada: tiene que
// aparecer SIEMPRE en el mensaje real (guildMemberAdd.test.js ya lo exige), pero NUNCA
// en la vista previa del editor (sería confuso duplicarlo si el admin ya lo menciona).
function ctx(overrides = {}) {
  return { servidor: 'Server de Prueba', usuario: '<@123>', usuarioNombre: 'Fran', miembroNumero: '42', avatarURL: 'https://cdn.discordapp.com/avatar.png', ...overrides };
}

describe('welcomeEmbed — buildWelcomeEmbed (mensaje real de guildMemberAdd)', () => {
  it('sin ningún campo custom: usa el texto de ejemplo con variables reemplazadas', () => {
    const embed = buildWelcomeEmbed({}, ctx());
    expect(embed.data.title).toBe('👋 ¡Bienvenido a Server de Prueba!');
    expect(embed.data.description).toContain('Hola <@123>.');
    expect(embed.data.description).toContain('Ya sos parte de nuestra comunidad.');
  });

  it('SIEMPRE agrega el hint de /help al final de la descripción, sea default o custom', () => {
    const withDefault = buildWelcomeEmbed({}, ctx());
    expect(withDefault.data.description).toMatch(/`\/help`/);

    const withCustom = buildWelcomeEmbed({ welcome_description: 'Un texto totalmente distinto, sin mencionar comandos.' }, ctx());
    expect(withCustom.data.description).toMatch(/`\/help`/);
  });

  it('título/descripción/footer custom reemplazan el default, con variables aplicadas', () => {
    const embed = buildWelcomeEmbed(
      { welcome_title: '🎉 {servidor} te espera', welcome_description: 'Bienvenido, {usuarioNombre} — sos el miembro #{miembroNumero}.', welcome_footer: 'Powered by {servidor}' },
      ctx(),
    );
    expect(embed.data.title).toBe('🎉 Server de Prueba te espera');
    expect(embed.data.description).toContain('Bienvenido, Fran — sos el miembro #42.');
    expect(embed.data.footer.text).toBe('Powered by Server de Prueba');
  });

  it('sin footer custom: usa BRAND_NAME', () => {
    const embed = buildWelcomeEmbed({}, ctx());
    expect(embed.data.footer.text).toBeTruthy();
  });

  it('color hex válido se respeta; inválido cae al MAGENTA_COLOR por defecto', () => {
    const withValid = buildWelcomeEmbed({ welcome_color: '#123456' }, ctx());
    expect(withValid.data.color).toBe(0x123456);

    const withInvalid = buildWelcomeEmbed({ welcome_color: 'no-es-un-color' }, ctx());
    expect(withInvalid.data.color).toBeDefined();
    expect(withInvalid.data.color).not.toBe(0x123456);
  });

  it('trunca título/descripción/footer a los límites reales de Discord', () => {
    const embed = buildWelcomeEmbed(
      { welcome_title: 'A'.repeat(500), welcome_description: 'B'.repeat(5000), welcome_footer: 'C'.repeat(3000) },
      ctx(),
    );
    expect(embed.data.title.length).toBeLessThanOrEqual(256);
    expect(embed.data.description.length).toBeLessThanOrEqual(4096);
    expect(embed.data.footer.text.length).toBeLessThanOrEqual(2048);
  });

  it('usa el thumbnail del avatar provisto en el contexto', () => {
    const embed = buildWelcomeEmbed({}, ctx({ avatarURL: 'https://example.com/x.png' }));
    expect(embed.data.thumbnail.url).toBe('https://example.com/x.png');
  });
});

describe('welcomeEmbed — buildWelcomePreviewEmbed (editor de /setup)', () => {
  it('NUNCA agrega el trailer de /help — evita duplicarlo si el admin lo escribe', () => {
    const preview = buildWelcomePreviewEmbed({}, ctx());
    expect(preview.data.description).not.toMatch(/`\/help`/);
    expect(preview.data.description).toBe(DEFAULT_WELCOME_DESCRIPTION.replaceAll('{usuario}', '<@123>'));
  });

  it('un draft vacío muestra exactamente el título/descripción de ejemplo', () => {
    const preview = buildWelcomePreviewEmbed({}, ctx());
    expect(preview.data.title).toBe(DEFAULT_WELCOME_TITLE.replace('{servidor}', 'Server de Prueba'));
  });
});

describe('welcomeEmbed — contextFromMember / contextFromInteraction', () => {
  it('contextFromMember arma el contexto a partir de un GuildMember real', () => {
    const member = {
      guild: { name: 'Mi Server', memberCount: 100 },
      displayName: 'ApodoDeServer',
      toString: () => '<@999>',
      user: { displayAvatarURL: () => 'https://cdn/avatar999.png' },
    };
    const result = contextFromMember(member);
    expect(result).toEqual({ servidor: 'Mi Server', usuario: '<@999>', usuarioNombre: 'ApodoDeServer', miembroNumero: '100', avatarURL: 'https://cdn/avatar999.png' });
  });

  it('contextFromInteraction usa el displayName del member, con fallback al username', () => {
    const withMember = contextFromInteraction({
      guild: { name: 'Srv', memberCount: 5 },
      user: { toString: () => '<@1>', username: 'usuario1', displayAvatarURL: () => 'url' },
      member: { displayName: 'Apodo' },
    });
    expect(withMember.usuarioNombre).toBe('Apodo');

    const withoutMember = contextFromInteraction({
      guild: { name: 'Srv', memberCount: 5 },
      user: { toString: () => '<@1>', username: 'usuario1', displayAvatarURL: () => 'url' },
      member: null,
    });
    expect(withoutMember.usuarioNombre).toBe('usuario1');
  });
});

describe('welcomeEmbed — isCustomWelcomeConfigured', () => {
  it('false si las 4 columnas están vacías/null', () => {
    expect(isCustomWelcomeConfigured({})).toBe(false);
    expect(isCustomWelcomeConfigured({ welcome_title: null, welcome_description: null, welcome_color: null, welcome_footer: null })).toBe(false);
  });

  it('true si CUALQUIERA de las 4 tiene valor', () => {
    expect(isCustomWelcomeConfigured({ welcome_footer: 'Solo esto' })).toBe(true);
    expect(isCustomWelcomeConfigured({ welcome_color: '#123456' })).toBe(true);
  });
});
