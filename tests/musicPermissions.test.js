import { describe, it, expect, beforeEach } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import * as store from '../src/utils/musicSessionStore.js';
import {
  requireUserInVoiceChannel,
  requireBotVoicePermissions,
  requireActiveSession,
  requireActiveSessionInUserChannel,
  getUserVoiceChannel,
} from '../src/utils/musicPermissions.js';

function makeInteraction({ guildId = 'guild-1', voiceChannelId = null } = {}) {
  return {
    guildId,
    member: { voice: { channel: voiceChannelId ? { id: voiceChannelId } : null } },
  };
}

function makeVoiceChannel({ allowed = [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak], hasMe = true } = {}) {
  return {
    guild: { members: { me: hasMe ? {} : null } },
    permissionsFor: () => ({ has: (flag) => allowed.includes(flag) }),
  };
}

beforeEach(() => {
  store._resetAllSessionsForTests();
});

describe('requireUserInVoiceChannel', () => {
  it('null si el usuario está en un canal de voz', () => {
    expect(requireUserInVoiceChannel(makeInteraction({ voiceChannelId: 'vc-1' }))).toBeNull();
  });

  it('error si el usuario no está en ningún canal de voz', () => {
    expect(requireUserInVoiceChannel(makeInteraction())).toMatch(/canal de voz/i);
  });
});

describe('getUserVoiceChannel', () => {
  it('devuelve el canal cuando existe', () => {
    expect(getUserVoiceChannel(makeInteraction({ voiceChannelId: 'vc-1' }))?.id).toBe('vc-1');
  });

  it('devuelve null cuando no hay member.voice.channel', () => {
    expect(getUserVoiceChannel(makeInteraction())).toBeNull();
  });
});

describe('requireBotVoicePermissions', () => {
  it('null si el bot tiene Connect y Speak', () => {
    expect(requireBotVoicePermissions(makeVoiceChannel())).toBeNull();
  });

  it('error si falta Connect', () => {
    const channel = makeVoiceChannel({ allowed: [PermissionFlagsBits.Speak] });
    expect(requireBotVoicePermissions(channel)).toMatch(/Conectar/);
  });

  it('error si falta Speak', () => {
    const channel = makeVoiceChannel({ allowed: [PermissionFlagsBits.Connect] });
    expect(requireBotVoicePermissions(channel)).toMatch(/Hablar/);
  });

  it('error si no se puede resolver el miembro del bot', () => {
    const channel = makeVoiceChannel({ hasMe: false });
    expect(requireBotVoicePermissions(channel)).toMatch(/permisos del bot/);
  });
});

describe('requireActiveSession (solo lectura, sin exigir mismo canal)', () => {
  it('error si no hay sesión activa', () => {
    const result = requireActiveSession(makeInteraction({ guildId: 'sin-sesion' }));
    expect(result.error).toMatch(/no hay ninguna reproducción/i);
  });

  it('devuelve la sesión aunque el usuario esté en otro canal (o en ninguno)', () => {
    store.createSession('guild-1', { voiceChannelId: 'vc-bot', textChannel: {} });
    const result = requireActiveSession(makeInteraction({ guildId: 'guild-1' })); // sin canal de voz
    expect(result.session).toBeDefined();
    expect(result.error).toBeUndefined();
  });
});

describe('requireActiveSessionInUserChannel (control real de la reproducción)', () => {
  it('error si no hay sesión activa', () => {
    const result = requireActiveSessionInUserChannel(makeInteraction({ guildId: 'sin-sesion', voiceChannelId: 'vc-1' }));
    expect(result.error).toMatch(/no hay ninguna reproducción/i);
  });

  it('error si el usuario no está en ningún canal de voz', () => {
    store.createSession('guild-1', { voiceChannelId: 'vc-bot', textChannel: {} });
    const result = requireActiveSessionInUserChannel(makeInteraction({ guildId: 'guild-1' }));
    expect(result.error).toMatch(/mismo canal de voz/i);
  });

  it('error si el usuario está en un canal de voz DISTINTO al del bot — no puede controlar música de otro canal', () => {
    store.createSession('guild-1', { voiceChannelId: 'vc-bot', textChannel: {} });
    const result = requireActiveSessionInUserChannel(makeInteraction({ guildId: 'guild-1', voiceChannelId: 'vc-otro' }));
    expect(result.error).toMatch(/mismo canal de voz/i);
  });

  it('devuelve la sesión si el usuario está en el MISMO canal que el bot', () => {
    const session = store.createSession('guild-1', { voiceChannelId: 'vc-bot', textChannel: {} });
    const result = requireActiveSessionInUserChannel(makeInteraction({ guildId: 'guild-1', voiceChannelId: 'vc-bot' }));
    expect(result.session).toBe(session);
    expect(result.error).toBeUndefined();
  });
});
