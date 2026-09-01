import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createSupabaseMock } from './helpers/supabaseMock.js';

// grantMessageXp es el único punto de entrada de XP por actividad (messageCreate) — sus
// 3 filtros anti-farm (mensaje corto, contenido repetido, cooldown de 60s) son la parte
// con más riesgo real: si alguno se rompe, se puede farmear XP mandando spam. Lo que se
// prueba acá es exactamente eso — que un mensaje que NO debería dar XP nunca llega a
// tocar Postgres (ni rpc ni update).
const supabaseMock = createSupabaseMock();
vi.mock('../src/supabaseClient.js', () => ({ get supabase() { return supabaseMock; } }));

const { grantMessageXp, addXp } = await import('../src/utils/xpStore.js');

function setUserXp({ xp = 0, level = 0, lastXpTs = 0, lastContent = '' } = {}) {
  supabaseMock.getBuilder('xp').__setResult({
    data: { xp, level, last_xp_ts: lastXpTs, last_content: lastContent },
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseMock.rpc.mockReset();
  supabaseMock.getBuilder('xp').__setResult({ data: null, error: null });
});

describe('grantMessageXp — filtros anti-farm', () => {
  it('mensaje demasiado corto no otorga XP ni toca Supabase', async () => {
    setUserXp({ lastXpTs: 0, lastContent: '' });

    const result = await grantMessageXp('guild-1', 'user-1', 'xd');

    expect(result).toBeNull();
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('el mismo contenido repetido consecutivo no otorga XP', async () => {
    setUserXp({ lastXpTs: 0, lastContent: 'hola a todos' });

    const result = await grantMessageXp('guild-1', 'user-1', 'hola a todos');

    expect(result).toBeNull();
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('dentro del cooldown de 60s desde el último mensaje que dio XP, no otorga XP', async () => {
    setUserXp({ lastXpTs: Date.now() - 5_000, lastContent: 'mensaje anterior' });

    const result = await grantMessageXp('guild-1', 'user-1', 'un mensaje nuevo y distinto');

    expect(result).toBeNull();
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('un mensaje válido sí llama a increment_xp con un monto entre 15 y 25', async () => {
    setUserXp({ lastXpTs: Date.now() - 120_000, lastContent: 'algo viejo' });
    supabaseMock.rpc.mockResolvedValue({ data: 40, error: null });

    const result = await grantMessageXp('guild-1', 'user-1', 'mensaje nuevo válido');

    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    const [, params] = supabaseMock.rpc.mock.calls[0];
    expect(params.p_amount).toBeGreaterThanOrEqual(15);
    expect(params.p_amount).toBeLessThanOrEqual(25);
    expect(result.gained).toBe(params.p_amount);
  });
});

// Fase 2A (2026-08-31) — grantMessageXp corre ahora bajo withLock por guild+usuario (ver
// xpStore.js). Este test simula el estado real de la fila 'xp' en memoria (a diferencia
// del resto del archivo, que usa un __setResult estático) para poder demostrar la
// carrera de verdad: sin el lock, las dos llamadas leerían el mismo lastXpTs viejo antes
// de que cualquiera escriba, y las dos pasarían el cooldown.
describe('grantMessageXp — concurrencia (Fase 2A)', () => {
  it('dos mensajes casi simultáneos del mismo usuario: el segundo respeta el cooldown que dejó el primero', async () => {
    let row = { xp: 100, level: 0, last_xp_ts: Date.now() - 120_000, last_content: 'viejo', xp_boost_until: 0, prestige: 0 };
    let pendingPatch = null;
    const builder = supabaseMock.getBuilder('xp');

    builder.select.mockImplementation(() => builder);
    builder.eq.mockImplementation(() => builder);
    builder.update.mockImplementation((patch) => {
      pendingPatch = patch;
      return builder;
    });
    builder.maybeSingle.mockImplementation(() => Promise.resolve({ data: { ...row }, error: null }));
    builder.single.mockImplementation(() => {
      if (pendingPatch) {
        row = { ...row, ...pendingPatch };
        pendingPatch = null;
      }
      return Promise.resolve({ data: { ...row }, error: null });
    });

    supabaseMock.rpc.mockImplementation(async (fn, params) => {
      if (fn === 'increment_xp') {
        row = { ...row, xp: row.xp + params.p_amount };
        return { data: row.xp, error: null };
      }
      return { data: null, error: null };
    });

    const [a, b] = await Promise.all([
      grantMessageXp('guild-1', 'user-1', 'primer mensaje distinto'),
      grantMessageXp('guild-1', 'user-1', 'segundo mensaje distinto'),
    ]);

    // Sin el lock, las dos hubieran leído el mismo lastXpTs viejo y las dos habrían
    // ganado XP — con el lock, la segunda ve el lastXpTs que dejó la primera y respeta
    // el cooldown de 60s.
    const granted = [a, b].filter((r) => r !== null);
    expect(granted.length).toBe(1);
  });
});

describe('addXp — detección de subida de nivel', () => {
  it('leveledUp es true cuando el nuevo total cruza el umbral del siguiente nivel', async () => {
    // xpRequiredForLevel(0) = 100 → con 90 de xp previa y +20, el total (110) ya es nivel 1.
    supabaseMock.rpc.mockResolvedValue({ data: 110, error: null });
    supabaseMock.getBuilder('xp').__setResult({
      data: { xp: 110, level: 1, last_xp_ts: 0, last_content: '' },
      error: null,
    });

    const result = await addXp('guild-1', 'user-1', 20);

    expect(result.previousLevel).toBe(0);
    expect(result.newLevel).toBe(1);
    expect(result.leveledUp).toBe(true);
  });

  it('leveledUp es false cuando el nuevo total no alcanza a cruzar de nivel', async () => {
    // Con 50 de xp previa y +20 (total 70), sigue en nivel 0 (hace falta 100).
    supabaseMock.rpc.mockResolvedValue({ data: 70, error: null });
    supabaseMock.getBuilder('xp').__setResult({
      data: { xp: 70, level: 0, last_xp_ts: 0, last_content: '' },
      error: null,
    });

    const result = await addXp('guild-1', 'user-1', 20);

    expect(result.previousLevel).toBe(0);
    expect(result.newLevel).toBe(0);
    expect(result.leveledUp).toBe(false);
  });
});
