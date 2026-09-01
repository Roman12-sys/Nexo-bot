import { describe, it, expect, beforeEach } from 'vitest';
import { setAfk, getAfk, clearAfk, clearGuildAfk } from '../src/utils/afkStore.js';

// afkStore.js es un Map en memoria compartido por TODO el proceso (mismo patrón que
// guessSessions.js/giveTracker.js) — sin limpieza real, una entrada de un usuario que se
// fue del server (o de un guild que el bot abandonó) quedaba viva para siempre. Fase 2A
// (2026-08-31) agregó clearGuildAfk + su llamada desde guildMemberRemove/guildDelete.
describe('afkStore', () => {
  beforeEach(() => {
    // No hay reset expuesto a propósito (mismo criterio que el Map real en producción,
    // nunca se "reinicia" solo) — cada test usa guild/user ids propios para no pisarse.
  });

  it('setAfk + getAfk: una entrada válida sigue funcionando normalmente', () => {
    setAfk('guild-1', 'user-1', 'reunión');
    const entry = getAfk('guild-1', 'user-1');

    expect(entry.reason).toBe('reunión');
    expect(entry.since).toEqual(expect.any(Number));
  });

  it('getAfk de alguien que nunca se puso AFK devuelve null', () => {
    expect(getAfk('guild-1', 'nadie-nunca')).toBeNull();
  });

  it('clearAfk borra solo la entrada de ese usuario en ese guild', () => {
    setAfk('guild-2', 'user-a', 'algo');
    setAfk('guild-2', 'user-b', 'otra cosa');

    clearAfk('guild-2', 'user-a');

    expect(getAfk('guild-2', 'user-a')).toBeNull();
    expect(getAfk('guild-2', 'user-b')).not.toBeNull();
  });

  it('member removal (clearAfk): un usuario AFK que se va del server deja de aparecer', () => {
    setAfk('guild-3', 'user-1', 'se fue');
    clearAfk('guild-3', 'user-1');

    expect(getAfk('guild-3', 'user-1')).toBeNull();
  });

  it('guild deletion (clearGuildAfk): borra TODAS las entradas de ese guild, ninguna de otro', () => {
    setAfk('guild-4', 'user-1', 'a');
    setAfk('guild-4', 'user-2', 'b');
    setAfk('guild-5', 'user-1', 'c'); // mismo user id, guild distinto — no debe tocarse

    clearGuildAfk('guild-4');

    expect(getAfk('guild-4', 'user-1')).toBeNull();
    expect(getAfk('guild-4', 'user-2')).toBeNull();
    expect(getAfk('guild-5', 'user-1')).not.toBeNull();
  });

  it('clearGuildAfk sobre un guild sin IDs con prefijo compartido no borra el guild vecino (ej. "12" vs "123")', () => {
    setAfk('12', 'user-1', 'a');
    setAfk('123', 'user-1', 'b');

    clearGuildAfk('12');

    expect(getAfk('12', 'user-1')).toBeNull();
    expect(getAfk('123', 'user-1')).not.toBeNull();
  });

  it('clearGuildAfk sobre un guild sin entradas no rompe nada', () => {
    expect(() => clearGuildAfk('guild-sin-afk')).not.toThrow();
  });
});
