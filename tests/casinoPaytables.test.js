import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Tablas de pago del casino (2026-09-27). casinoHelpers.test.js cubre el cobro, el lock
// y el pago, pero nada fijaba QUÉ paga cada juego: cambiar un número de la tabla del
// tragamonedas cambia cuánto se queda la casa sin que ningún test lo note. Estos tests
// son el contrato: si alguien cambia una tabla a propósito, tiene que cambiar el número
// acá también, y eso lo obliga a mirar la ventaja de la casa.
let captured;
vi.mock('../src/utils/casinoHelpers.js', async (importOriginal) => ({
  ...(await importOriginal()),
  playCasinoGame: vi.fn(async (_interaction, opts) => {
    captured = opts;
  }),
}));

const slots = await import('../src/commands/economia/slots.js');
const ruleta = await import('../src/commands/economia/ruleta.js');

function interactionWith({ apuesta = 100, color = null } = {}) {
  return { options: { getInteger: () => apuesta, getString: () => color } };
}

function stubRandom(values) {
  const queue = [...values];
  vi.spyOn(Math, 'random').mockImplementation(() => queue.shift());
}

beforeEach(() => {
  captured = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('/slots — resultados', () => {
  it('tres iguales pagan según el símbolo (tres 7️⃣ = x15)', async () => {
    await slots.execute(interactionWith({ apuesta: 100 }));
    stubRandom([0.99, 0.99, 0.99]);

    expect(captured.resolve()).toMatchObject({ outcome: 'win', payout: 1500 });
  });

  it('dos iguales devuelven la apuesta', async () => {
    await slots.execute(interactionWith({ apuesta: 100 }));
    stubRandom([0.1, 0.1, 0.5]); // 🍒 🍒 🍋

    expect(captured.resolve()).toMatchObject({ outcome: 'push', payout: 100 });
  });

  it('todos distintos pierden todo', async () => {
    await slots.execute(interactionWith({ apuesta: 100 }));
    stubRandom([0.1, 0.5, 0.99]); // 🍒 🍋 7️⃣

    expect(captured.resolve()).toMatchObject({ outcome: 'lose', payout: 0 });
  });

  it('devuelve el 67,9% de lo apostado: la casa se queda con ~32% (cálculo exacto sobre la tabla real)', () => {
    const total = slots.SYMBOLS.reduce((sum, s) => sum + s.weight, 0);
    const p = slots.SYMBOLS.map((s) => s.weight / total);

    let threeOfAKind = 0;
    let threeOfAKindPays = 0;
    slots.SYMBOLS.forEach((s, i) => {
      threeOfAKind += p[i] ** 3;
      threeOfAKindPays += p[i] ** 3 * s.payout;
    });
    let allDifferent = 0;
    for (let i = 0; i < p.length; i++) for (let j = 0; j < p.length; j++) for (let k = 0; k < p.length; k++) {
      if (i !== j && j !== k && i !== k) allDifferent += p[i] * p[j] * p[k];
    }
    const pushChance = 1 - allDifferent - threeOfAKind;
    const returnPerCoin = threeOfAKindPays + pushChance;

    expect(returnPerCoin).toBeCloseTo(0.6792, 3);
  });
});

describe('/ruleta — resultados', () => {
  const spinTo = (n) => stubRandom([(n + 0.5) / 37]);

  it('rojo que sale rojo paga x2', async () => {
    await ruleta.execute(interactionWith({ apuesta: 100, color: 'rojo' }));
    spinTo(1);

    expect(captured.resolve()).toMatchObject({ outcome: 'win', payout: 200 });
  });

  it('el 0 es verde y paga x30', async () => {
    await ruleta.execute(interactionWith({ apuesta: 100, color: 'verde' }));
    spinTo(0);

    expect(captured.resolve()).toMatchObject({ outcome: 'win', payout: 3000 });
  });

  it('rojo que sale negro pierde todo', async () => {
    await ruleta.execute(interactionWith({ apuesta: 100, color: 'rojo' }));
    spinTo(2);

    expect(captured.resolve()).toMatchObject({ outcome: 'lose', payout: 0 });
  });

  it('rojo gana en 18 de 37 números (devuelve 97,3%) y verde en 1 de 37 (devuelve 81%)', async () => {
    const wins = { rojo: 0, verde: 0 };
    for (const color of ['rojo', 'verde']) {
      await ruleta.execute(interactionWith({ apuesta: 100, color }));
      for (let n = 0; n <= 36; n++) {
        spinTo(n);
        if (captured.resolve().outcome === 'win') wins[color] += 1;
        vi.restoreAllMocks();
      }
    }

    expect(wins).toEqual({ rojo: 18, verde: 1 });
    expect((wins.rojo / 37) * 2).toBeCloseTo(0.973, 3);
    expect((wins.verde / 37) * 30).toBeCloseTo(0.811, 3);
  });
});
