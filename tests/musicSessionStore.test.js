import { describe, it, expect, beforeEach } from 'vitest';
import * as store from '../src/utils/musicSessionStore.js';

function track(title, overrides = {}) {
  return { title, url: `https://example.com/${title}`, durationSec: 120, requestedBy: { id: 'user-1' }, ...overrides };
}

beforeEach(() => {
  store._resetAllSessionsForTests();
});

describe('createSession / getSession / hasSession', () => {
  it('crea una sesión nueva con los defaults esperados', () => {
    const session = store.createSession('guild-1', { voiceChannelId: 'vc-1', textChannel: { id: 'tc-1' } });
    expect(session.guildId).toBe('guild-1');
    expect(session.queue).toEqual([]);
    expect(session.current).toBeNull();
    expect(session.loopMode).toBe('off');
    expect(session.volume).toBe(store.DEFAULT_VOLUME);
    expect(store.hasSession('guild-1')).toBe(true);
    expect(store.getSession('guild-1')).toBe(session);
  });

  it('getSession/hasSession de un guild sin sesión no explota', () => {
    expect(store.getSession('nadie')).toBeNull();
    expect(store.hasSession('nadie')).toBe(false);
  });
});

describe('aislamiento entre servidores', () => {
  it('la cola/volumen/loop de un guild nunca afecta a otro', () => {
    store.createSession('guild-a', { voiceChannelId: 'vc-a', textChannel: { id: 'tc-a' } });
    store.createSession('guild-b', { voiceChannelId: 'vc-b', textChannel: { id: 'tc-b' } });

    store.addTrack('guild-a', track('a1'));
    store.setVolume('guild-a', 50);
    store.setLoopMode('guild-a', 'queue');

    const sessionB = store.getSession('guild-b');
    expect(sessionB.queue).toEqual([]);
    expect(sessionB.volume).toBe(store.DEFAULT_VOLUME);
    expect(sessionB.loopMode).toBe('off');
  });
});

describe('addTrack', () => {
  it('agrega canciones y devuelve la posición', () => {
    store.createSession('guild-1', { voiceChannelId: 'vc-1', textChannel: {} });
    expect(store.addTrack('guild-1', track('a'))).toEqual({ ok: true, position: 1 });
    expect(store.addTrack('guild-1', track('b'))).toEqual({ ok: true, position: 2 });
  });

  it('rechaza agregar sin sesión existente', () => {
    expect(store.addTrack('nadie', track('a'))).toEqual({ ok: false, reason: 'no_session' });
  });

  it('rechaza agregar más allá de MAX_QUEUE_SIZE (evita crecimiento de memoria sin límite)', () => {
    store.createSession('guild-1', { voiceChannelId: 'vc-1', textChannel: {} });
    for (let i = 0; i < store.MAX_QUEUE_SIZE; i++) {
      expect(store.addTrack('guild-1', track(`t${i}`)).ok).toBe(true);
    }
    expect(store.addTrack('guild-1', track('overflow'))).toEqual({ ok: false, reason: 'queue_full' });
  });
});

describe('removeTrack', () => {
  it('saca por posición 1-indexada', () => {
    store.createSession('guild-1', { voiceChannelId: 'vc-1', textChannel: {} });
    store.addTrack('guild-1', track('a'));
    store.addTrack('guild-1', track('b'));
    store.addTrack('guild-1', track('c'));

    const removed = store.removeTrack('guild-1', 2);
    expect(removed.title).toBe('b');
    expect(store.getSession('guild-1').queue.map((t) => t.title)).toEqual(['a', 'c']);
  });

  it('posición fuera de rango devuelve null sin tocar la cola', () => {
    store.createSession('guild-1', { voiceChannelId: 'vc-1', textChannel: {} });
    store.addTrack('guild-1', track('a'));
    expect(store.removeTrack('guild-1', 0)).toBeNull();
    expect(store.removeTrack('guild-1', 5)).toBeNull();
    expect(store.getSession('guild-1').queue).toHaveLength(1);
  });
});

describe('shufflePending', () => {
  it('nunca toca session.current, solo la cola pendiente', () => {
    store.createSession('guild-1', { voiceChannelId: 'vc-1', textChannel: {} });
    const session = store.getSession('guild-1');
    session.current = track('reproduciendo');
    for (let i = 0; i < 20; i++) store.addTrack('guild-1', track(`t${i}`));

    const beforeTitles = session.queue.map((t) => t.title).sort();
    store.shufflePending('guild-1');
    const afterTitles = session.queue.map((t) => t.title).sort();

    expect(session.current.title).toBe('reproduciendo');
    expect(afterTitles).toEqual(beforeTitles); // mismo set de canciones, solo reordenadas
  });
});

describe('clearQueue', () => {
  it('vacía la cola pendiente sin tocar la canción actual', () => {
    store.createSession('guild-1', { voiceChannelId: 'vc-1', textChannel: {} });
    const session = store.getSession('guild-1');
    session.current = track('actual');
    store.addTrack('guild-1', track('a'));
    store.addTrack('guild-1', track('b'));

    store.clearQueue('guild-1');
    expect(session.queue).toEqual([]);
    expect(session.current.title).toBe('actual');
  });
});

describe('setLoopMode / setVolume', () => {
  it('rechaza un modo de loop inválido', () => {
    store.createSession('guild-1', { voiceChannelId: 'vc-1', textChannel: {} });
    expect(store.setLoopMode('guild-1', 'track')).toBe(true);
    expect(store.setLoopMode('guild-1', 'algo-invalido')).toBe(false);
    expect(store.getSession('guild-1').loopMode).toBe('track'); // no se pisó con el inválido
  });

  it('clampea el volumen entre MIN_VOLUME y MAX_VOLUME', () => {
    store.createSession('guild-1', { voiceChannelId: 'vc-1', textChannel: {} });
    expect(store.setVolume('guild-1', -50)).toBe(store.MIN_VOLUME);
    expect(store.setVolume('guild-1', 99999)).toBe(store.MAX_VOLUME);
    expect(store.setVolume('guild-1', 75)).toBe(75);
  });
});

describe('advance — matemática de la cola según el modo de loop', () => {
  it("loop 'off': descarta la actual y toma la próxima", () => {
    store.createSession('guild-1', { voiceChannelId: 'vc-1', textChannel: {} });
    const session = store.getSession('guild-1');
    session.current = track('actual');
    store.addTrack('guild-1', track('siguiente'));

    const next = store.advance('guild-1');
    expect(next.title).toBe('siguiente');
    expect(session.queue).toEqual([]);
  });

  it("loop 'track': repite la misma canción indefinidamente sin consumir la cola", () => {
    store.createSession('guild-1', { voiceChannelId: 'vc-1', textChannel: {} });
    store.setLoopMode('guild-1', 'track');
    const session = store.getSession('guild-1');
    session.current = track('actual');
    store.addTrack('guild-1', track('otra'));

    expect(store.advance('guild-1').title).toBe('actual');
    expect(store.advance('guild-1').title).toBe('actual');
    expect(session.queue.map((t) => t.title)).toEqual(['otra']); // nunca se tocó
  });

  it("loop 'queue': reencola la actual al final antes de tomar la próxima", () => {
    store.createSession('guild-1', { voiceChannelId: 'vc-1', textChannel: {} });
    store.setLoopMode('guild-1', 'queue');
    const session = store.getSession('guild-1');
    session.current = track('a');
    store.addTrack('guild-1', track('b'));

    expect(store.advance('guild-1').title).toBe('b');
    expect(session.queue.map((t) => t.title)).toEqual(['a']);
    expect(store.advance('guild-1').title).toBe('a'); // vuelta completa
  });

  it('una canción marcada .failed nunca se repite, sin importar el modo de loop (evita loop infinito de reintentos)', () => {
    store.createSession('guild-1', { voiceChannelId: 'vc-1', textChannel: {} });
    store.setLoopMode('guild-1', 'track');
    const session = store.getSession('guild-1');
    session.current = track('rota');
    store.addTrack('guild-1', track('siguiente'));

    store.markCurrentTrackFailed('guild-1');
    const next = store.advance('guild-1');

    expect(next.title).toBe('siguiente'); // NO repitió "rota" pese a loop:'track'
    expect(session.queue).toEqual([]); // tampoco quedó reencolada
  });

  it('sin nada en cola y sin canción actual, devuelve null', () => {
    store.createSession('guild-1', { voiceChannelId: 'vc-1', textChannel: {} });
    expect(store.advance('guild-1')).toBeNull();
  });
});

describe('deleteSession', () => {
  it('borra el registro y devuelve la sesión borrada', () => {
    const created = store.createSession('guild-1', { voiceChannelId: 'vc-1', textChannel: {} });
    const deleted = store.deleteSession('guild-1');
    expect(deleted).toBe(created);
    expect(store.hasSession('guild-1')).toBe(false);
  });

  it('borrar un guild sin sesión no explota', () => {
    expect(store.deleteSession('nadie')).toBeNull();
  });
});
