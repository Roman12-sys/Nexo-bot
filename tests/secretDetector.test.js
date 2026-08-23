import { describe, it, expect } from 'vitest';
import { detectSecret, redactSecretsInText } from '../src/utils/secretDetector.js';

// Los fixtures de acá abajo tienen la FORMA de un secreto real (longitud/estructura
// que matchea los regex de secretDetector.js) pero están armados con caracteres
// repetidos a propósito — nunca alta entropía tipo base64 real — para que ningún
// escáner de secretos (el de GitHub incluido) los confunda con uno de verdad.
const FAKE_DISCORD_TOKEN = `${'X'.repeat(24)}.${'Y'.repeat(6)}.${'Z'.repeat(27)}`;
const FAKE_ANTHROPIC_KEY = `sk-ant-${'X'.repeat(25)}`;
const FAKE_AWS_KEY_A = `AKIA${'X'.repeat(16)}`;
const FAKE_AWS_KEY_B = `AKIA${'Y'.repeat(16)}`;

describe('detectSecret', () => {
  it('detecta un token de bot de Discord', () => {
    const result = detectSecret(`mirá mi token: ${FAKE_DISCORD_TOKEN}`);
    expect(result?.type).toBe('Discord bot token');
  });

  it('detecta una API key estilo OpenAI/Anthropic', () => {
    const result = detectSecret(FAKE_ANTHROPIC_KEY);
    expect(result?.type).toBe('API key (OpenAI/Anthropic)');
  });

  it('detecta una variable de entorno filtrada', () => {
    const result = detectSecret('DISCORD_TOKEN=valorsecreto123456');
    expect(result?.type).toBe('Variable de entorno filtrada');
  });

  it('no marca un mensaje normal como secreto', () => {
    expect(detectSecret('hola, alguien vio el último capítulo?')).toBeNull();
    expect(detectSecret('')).toBeNull();
    expect(detectSecret(null)).toBeNull();
  });

  it('la vista previa nunca incluye el secreto completo', () => {
    const result = detectSecret(`aws key: ${FAKE_AWS_KEY_A}`);
    expect(result.preview).not.toContain(FAKE_AWS_KEY_A);
    expect(result.preview).toContain('•');
  });
});

describe('redactSecretsInText', () => {
  it('redacta todas las ocurrencias, no solo la primera', () => {
    const text = `primero ${FAKE_AWS_KEY_A} y después ${FAKE_AWS_KEY_B}`;
    const redacted = redactSecretsInText(text);
    expect(redacted).not.toContain(FAKE_AWS_KEY_A);
    expect(redacted).not.toContain(FAKE_AWS_KEY_B);
  });

  it('texto sin secretos queda igual', () => {
    expect(redactSecretsInText('todo normal por acá')).toBe('todo normal por acá');
  });
});
