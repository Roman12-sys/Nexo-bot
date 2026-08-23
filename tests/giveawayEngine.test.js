import { vi, describe, it, expect } from 'vitest';

// giveawayEngine.js importa giveawaysStore.js, que a su vez importa supabaseClient.js
// (requiere variables de entorno reales). Se mockea para testear pickWinners() aislado.
vi.mock('../src/supabaseClient.js', () => ({ supabase: {} }));

const { pickWinners } = await import('../src/utils/giveawayEngine.js');

describe('pickWinners', () => {
  it('nunca elige más ganadores de los que hay participantes', () => {
    const winners = pickWinners(['a', 'b'], 5);
    expect(winners.length).toBe(2);
  });

  it('elige exactamente "count" ganadores cuando hay participantes de sobra', () => {
    const participants = Array.from({ length: 20 }, (_, i) => `user${i}`);
    const winners = pickWinners(participants, 3);
    expect(winners.length).toBe(3);
  });

  it('nunca repite un ganador', () => {
    const participants = Array.from({ length: 30 }, (_, i) => `user${i}`);
    const winners = pickWinners(participants, 10);
    expect(new Set(winners).size).toBe(winners.length);
  });

  it('todos los ganadores salen de la lista de participantes', () => {
    const participants = ['a', 'b', 'c', 'd'];
    const winners = pickWinners(participants, 4);
    for (const w of winners) expect(participants).toContain(w);
  });

  it('no modifica el array de participantes original', () => {
    const participants = ['a', 'b', 'c'];
    const copy = [...participants];
    pickWinners(participants, 2);
    expect(participants).toEqual(copy);
  });

  it('lista vacía de participantes no elige a nadie', () => {
    expect(pickWinners([], 3)).toEqual([]);
  });
});
