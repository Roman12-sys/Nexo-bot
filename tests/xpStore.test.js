import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSupabaseMock } from './helpers/supabaseMock.js';

// xpStore.js importa supabaseClient.js a nivel de módulo, que a su vez requiere las
// variables de entorno de Supabase (config.js tira si faltan). Se mockea para poder
// testear tanto las fórmulas puras de nivel/XP como (más abajo, Fase A) el emit de
// XP_GAINED de addXp, sin necesitar un .env real ni red.
const supabaseMock = createSupabaseMock();
vi.mock('../src/supabaseClient.js', () => ({ get supabase() { return supabaseMock; } }));

const { xpRequiredForLevel, getLevelProgress, totalXpForLevel, addXp } = await import('../src/utils/xpStore.js');
const { eventBus } = await import('../src/utils/eventBus.js');

describe('xpRequiredForLevel', () => {
  it('sube con el nivel (curva no lineal)', () => {
    expect(xpRequiredForLevel(0)).toBe(100);
    expect(xpRequiredForLevel(1)).toBe(155);
    expect(xpRequiredForLevel(10)).toBe(1100);
  });
});

describe('totalXpForLevel / getLevelProgress son inversas', () => {
  it('la XP total para alcanzar un nivel, evaluada con getLevelProgress, da exactamente ese nivel con 0 XP de sobra', () => {
    for (const level of [0, 1, 5, 10, 25]) {
      const totalXp = totalXpForLevel(level);
      const progress = getLevelProgress(totalXp);
      expect(progress.level).toBe(level);
      expect(progress.currentLevelXp).toBe(0);
    }
  });

  it('un XP menos que lo necesario para el próximo nivel no sube de nivel', () => {
    const xpForLevel5 = totalXpForLevel(5);
    const progress = getLevelProgress(xpForLevel5 - 1);
    expect(progress.level).toBe(4);
  });

  it('totalXp=0 es nivel 0', () => {
    expect(getLevelProgress(0)).toMatchObject({ level: 0, currentLevelXp: 0 });
  });

  it('xpForNextLevel siempre coincide con xpRequiredForLevel del nivel actual', () => {
    const progress = getLevelProgress(1234);
    expect(progress.xpForNextLevel).toBe(xpRequiredForLevel(progress.level));
  });
});

// Fase A, segunda auditoría 2026-08-30 — addXp no debe seguir tratando cualquier XP
// otorgada a mano por staff como si fuera actividad orgánica del servidor (ver
// src/utils/economyOrigins.js, consumido por guildDailyStatsStore.js).
describe('addXp — Event Engine (Fase A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMock.rpc.mockReset();
    supabaseMock.getBuilder('xp').__setResult({ data: { xp: 100, level: 0, last_xp_ts: 0, last_content: '' }, error: null });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emite XP_GAINED con guildId/userId/amount/source/origin cuando amount > 0', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: 100, error: null });
    const emitSpy = vi.spyOn(eventBus, 'emit').mockResolvedValue(undefined);

    await addXp('guild-1', 'user-1', 20, { source: 'message' });

    expect(emitSpy).toHaveBeenCalledWith('XP_GAINED', {
      guildId: 'guild-1',
      userId: 'user-1',
      amount: 20,
      source: 'message',
      origin: 'activity',
    });
  });

  it('no emite XP_GAINED cuando amount <= 0', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: 80, error: null });
    const emitSpy = vi.spyOn(eventBus, 'emit').mockResolvedValue(undefined);

    await addXp('guild-1', 'user-1', -20);

    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('source "admin" (/xp de staff) se clasifica con origin "admin"', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: 500, error: null });
    const emitSpy = vi.spyOn(eventBus, 'emit').mockResolvedValue(undefined);

    await addXp('guild-1', 'user-1', 500, { source: 'admin' });

    expect(emitSpy).toHaveBeenCalledWith('XP_GAINED', expect.objectContaining({ origin: 'admin', source: 'admin' }));
  });

  it('sin source (compatibilidad hacia atrás) cae en origin "activity" por defecto', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: 15, error: null });
    const emitSpy = vi.spyOn(eventBus, 'emit').mockResolvedValue(undefined);

    await addXp('guild-1', 'user-1', 15);

    expect(emitSpy).toHaveBeenCalledWith('XP_GAINED', expect.objectContaining({ origin: 'activity', source: undefined }));
  });
});
