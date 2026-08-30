import { describe, it, expect } from 'vitest';
import {
  buildNowPlayingEmbed,
  buildAddedToQueueEmbed,
  buildQueueEmbed,
  buildQueueRow,
} from '../src/utils/musicEmbeds.js';

function track(overrides = {}) {
  return {
    title: 'Canción de prueba',
    uploader: 'Canal de prueba',
    durationSec: 225, // 3:45
    isLive: false,
    thumbnail: null,
    requestedBy: { id: 'user-1' },
    ...overrides,
  };
}

function fieldValue(embed, name) {
  return embed.data.fields.find((f) => f.name === name)?.value;
}

describe('buildNowPlayingEmbed', () => {
  it('incluye título, duración formateada y quién la pidió', () => {
    const embed = buildNowPlayingEmbed({ track: track(), loopMode: 'off', volume: 100, queueLength: 2, playbackDurationMs: 0 });
    expect(fieldValue(embed, 'Título')).toBe('Canción de prueba');
    expect(fieldValue(embed, 'Duración')).toBe('3:45');
    expect(fieldValue(embed, 'Solicitado por')).toBe('<@user-1>');
  });

  it('formatea duraciones de más de una hora como h:mm:ss', () => {
    const embed = buildNowPlayingEmbed({ track: track({ durationSec: 3725 }), loopMode: 'off', volume: 100, queueLength: 0, playbackDurationMs: 0 });
    expect(fieldValue(embed, 'Duración')).toBe('1:02:05');
  });

  it('una transmisión en vivo (durationSec null) muestra el texto de "en vivo" y no agrega barra de progreso', () => {
    const embed = buildNowPlayingEmbed({
      track: track({ durationSec: null, isLive: true }),
      loopMode: 'off',
      volume: 100,
      queueLength: 0,
      playbackDurationMs: 5000,
    });
    expect(fieldValue(embed, 'Duración')).toMatch(/en vivo/i);
    expect(fieldValue(embed, 'Progreso')).toBeUndefined();
  });

  it('agrega barra de progreso cuando hay duración conocida y no es en vivo', () => {
    const embed = buildNowPlayingEmbed({ track: track(), loopMode: 'off', volume: 100, queueLength: 0, playbackDurationMs: 60_000 });
    expect(fieldValue(embed, 'Progreso')).toBeDefined();
  });

  it('muestra el modo de loop legible', () => {
    const embed = buildNowPlayingEmbed({ track: track(), loopMode: 'queue', volume: 100, queueLength: 0, playbackDurationMs: 0 });
    expect(fieldValue(embed, 'Loop')).toBe('Cola completa');
  });
});

describe('buildAddedToQueueEmbed', () => {
  it('muestra la posición asignada', () => {
    const embed = buildAddedToQueueEmbed({ track: track(), position: 3, queueLength: 5 });
    expect(fieldValue(embed, 'Posición en cola')).toBe('3 de 5');
  });
});

describe('buildQueueEmbed — paginación', () => {
  function makeSession(queueSize) {
    return {
      current: track({ title: 'Actual' }),
      queue: Array.from({ length: queueSize }, (_, i) => track({ title: `Track ${i + 1}` })),
    };
  }

  it('con 25 canciones pendientes, muestra 10 por página y 3 páginas totales', () => {
    const session = makeSession(25);
    const { embed, clampedPage, totalPages } = buildQueueEmbed(session, 0);
    expect(totalPages).toBe(3);
    expect(clampedPage).toBe(0);
    const pending = embed.data.fields.find((f) => f.name.startsWith('Próximas canciones'));
    expect(pending.value.split('\n')).toHaveLength(10);
  });

  it('clampea una página fuera de rango a la última válida', () => {
    const session = makeSession(25);
    const { clampedPage } = buildQueueEmbed(session, 999);
    expect(clampedPage).toBe(2); // 25 canciones / 10 por página = 3 páginas (0,1,2)
  });

  it('clampea una página negativa a 0', () => {
    const session = makeSession(5);
    const { clampedPage } = buildQueueEmbed(session, -3);
    expect(clampedPage).toBe(0);
  });

  it('cola vacía muestra el mensaje correspondiente en vez de una lista vacía', () => {
    const session = makeSession(0);
    const { embed } = buildQueueEmbed(session, 0);
    const pending = embed.data.fields.find((f) => f.name === 'Próximas canciones');
    expect(pending.value).toMatch(/vacía/i);
  });
});

describe('buildQueueRow', () => {
  it('deshabilita "Anterior" en la primera página y "Siguiente" en la última', () => {
    const first = buildQueueRow(0, 3).components[0].data;
    const last = buildQueueRow(2, 3).components[1].data;
    expect(first.disabled).toBe(true);
    expect(last.disabled).toBe(true);
  });

  it('habilita ambos botones en una página intermedia', () => {
    const row = buildQueueRow(1, 3);
    expect(row.components[0].data.disabled).toBe(false);
    expect(row.components[1].data.disabled).toBe(false);
  });
});
