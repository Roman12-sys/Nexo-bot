import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSupabaseMock } from './helpers/supabaseMock.js';

// xpStore.js importa supabaseClient.js a nivel de módulo, que a su vez requiere las
// variables de entorno de Supabase (config.js tira si faltan). Se mockea para poder
// testear tanto las fórmulas puras de nivel/XP como (más abajo, Fase A) el emit de
// XP_GAINED de addXp, sin necesitar un .env real ni red.
const supabaseMock = createSupabaseMock();
vi.mock('../src/supabaseClient.js', () => ({ get supabase() { return supabaseMock; } }));

const { xpRequiredForLevel, getLevelProgress, totalXpForLevel, addXp, applyPrestige, getUserXp } = await import('../src/utils/xpStore.js');
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

// Fase 2A (2026-08-31) — applyPrestige pasó de read->calculate->write en JS a una sola
// RPC atómica (apply_prestige, "for update" en schema.sql) para que dos /prestigio
// simultáneos del mismo usuario no puedan leer el mismo prestige viejo y perder un
// incremento.
describe('applyPrestige — RPC atómica (Fase 2A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMock.rpc.mockReset();
  });

  it('llama la RPC apply_prestige con guildId/userId y devuelve el nuevo prestige', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: 3, error: null });

    const result = await applyPrestige('guild-1', 'user-1');

    expect(supabaseMock.rpc).toHaveBeenCalledWith('apply_prestige', { p_guild_id: 'guild-1', p_user_id: 'user-1' });
    expect(result).toBe(3);
  });

  it('dos llamadas concurrentes terminan en prestige +2, nunca +1 (simula el "for update" serializando en Postgres)', async () => {
    let prestige = 0;
    supabaseMock.rpc.mockImplementation(async () => {
      // Simula el lock de fila de la RPC real: cada llamada ve el resultado ya escrito
      // por la anterior, nunca el mismo valor "viejo" que otra llamada concurrente.
      prestige += 1;
      return { data: prestige, error: null };
    });

    const [a, b] = await Promise.all([applyPrestige('guild-1', 'user-1'), applyPrestige('guild-1', 'user-1')]);

    expect([a, b].sort()).toEqual([1, 2]);
    expect(prestige).toBe(2);
  });

  it('propaga el error si la RPC falla', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });

    await expect(applyPrestige('guild-1', 'user-1')).rejects.toBeTruthy();
  });
});

// Multi-guild (Fase 2A, 2026-08-31) — el MISMO userId con XP en dos guilds donde el bot
// está es el caso real de producción. xp.js no tiene cache en memoria propio; lo que
// importa acá es que guildId nunca se pierda ni se reutilice entre llamadas seguidas.
describe('multi-guild — el mismo userId en dos guilds nunca se mezcla', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMock.rpc.mockReset();
  });

  it('getUserXp: guild-a y guild-b para el mismo user_id consultan filas distintas', async () => {
    supabaseMock.getBuilder('xp').__setResult({ data: { xp: 0, level: 0, last_xp_ts: 0, last_content: '' }, error: null });

    await getUserXp('guild-a', 'user-123');
    await getUserXp('guild-b', 'user-123');

    const eqCalls = supabaseMock.getBuilder('xp').eq.mock.calls;
    expect(eqCalls).toEqual(
      expect.arrayContaining([
        ['guild_id', 'guild-a'],
        ['guild_id', 'guild-b'],
        ['user_id', 'user-123'],
      ]),
    );
  });

  it('addXp: dos llamadas para el mismo user_id en guilds distintos mandan cada una su propio p_guild_id a increment_xp', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: 100, error: null });
    supabaseMock.getBuilder('xp').__setResult({ data: { xp: 100, level: 0, last_xp_ts: 0, last_content: '' }, error: null });

    await addXp('guild-a', 'user-123', 50);
    await addXp('guild-b', 'user-123', 20);

    expect(supabaseMock.rpc).toHaveBeenNthCalledWith(1, 'increment_xp', { p_guild_id: 'guild-a', p_user_id: 'user-123', p_amount: 50 });
    expect(supabaseMock.rpc).toHaveBeenNthCalledWith(2, 'increment_xp', { p_guild_id: 'guild-b', p_user_id: 'user-123', p_amount: 20 });
  });

  it('applyPrestige: dos llamadas para el mismo user_id en guilds distintos mandan cada una su propio p_guild_id', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: 1, error: null });

    await applyPrestige('guild-a', 'user-123');
    await applyPrestige('guild-b', 'user-123');

    expect(supabaseMock.rpc).toHaveBeenNthCalledWith(1, 'apply_prestige', { p_guild_id: 'guild-a', p_user_id: 'user-123' });
    expect(supabaseMock.rpc).toHaveBeenNthCalledWith(2, 'apply_prestige', { p_guild_id: 'guild-b', p_user_id: 'user-123' });
  });
});
