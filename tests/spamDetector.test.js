import { describe, it, expect } from 'vitest';
import { detectSpam } from '../src/utils/spamDetector.js';

function makeMessage({ guildId = 'g1', userId = `u-${Math.random()}`, content = 'hola', mentionUsers = 0, mentionRoles = 0 } = {}) {
  return {
    guild: { id: guildId },
    author: { id: userId },
    content,
    mentions: {
      users: { size: mentionUsers },
      roles: { size: mentionRoles },
    },
  };
}

describe('detectSpam', () => {
  it('detecta menciones masivas de inmediato, sin importar el historial', () => {
    const msg = makeMessage({ mentionUsers: 4, mentionRoles: 2 });
    expect(detectSpam(msg)).toBe('mencion_masiva');
  });

  it('no dispara nada con mensajes normales y espaciados en contenido', () => {
    const userId = `u-${Math.random()}`;
    expect(detectSpam(makeMessage({ userId, content: 'hola' }))).toBeNull();
    expect(detectSpam(makeMessage({ userId, content: 'como andan' }))).toBeNull();
  });

  it('detecta flood: 5 mensajes seguidos del mismo usuario', () => {
    const userId = `u-${Math.random()}`;
    let lastResult = null;
    for (let i = 0; i < 5; i++) {
      lastResult = detectSpam(makeMessage({ userId, content: `mensaje ${i}` }));
    }
    expect(lastResult).toBe('flood');
  });

  it('detecta contenido duplicado: 3 repeticiones exactas antes de llegar al umbral de flood', () => {
    const userId = `u-${Math.random()}`;
    detectSpam(makeMessage({ userId, content: 'compren gift cards baratas' }));
    detectSpam(makeMessage({ userId, content: 'compren gift cards baratas' }));
    const result = detectSpam(makeMessage({ userId, content: 'compren gift cards baratas' }));
    expect(result).toBe('duplicado');
  });

  it('no trata mensajes vacíos repetidos (solo adjuntos) como duplicado', () => {
    const userId = `u-${Math.random()}`;
    expect(detectSpam(makeMessage({ userId, content: '' }))).toBeNull();
    expect(detectSpam(makeMessage({ userId, content: '' }))).toBeNull();
    expect(detectSpam(makeMessage({ userId, content: '' }))).toBeNull();
  });

  it('usuarios distintos no comparten historial', () => {
    const userA = `u-a-${Math.random()}`;
    const userB = `u-b-${Math.random()}`;
    for (let i = 0; i < 4; i++) detectSpam(makeMessage({ userId: userA, content: `msg ${i}` }));
    expect(detectSpam(makeMessage({ userId: userB, content: 'hola' }))).toBeNull();
  });

  it('limpia el historial tras disparar, así el siguiente mensaje no re-dispara solo', () => {
    const userId = `u-${Math.random()}`;
    for (let i = 0; i < 5; i++) detectSpam(makeMessage({ userId, content: `flood ${i}` }));
    expect(detectSpam(makeMessage({ userId, content: 'mensaje normal' }))).toBeNull();
  });
});
