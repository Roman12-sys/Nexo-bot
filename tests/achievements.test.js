import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createSupabaseMock } from './helpers/supabaseMock.js';

// achievements.js consolidó 11 call-sites en un solo handler de ACHIEVEMENT_CHECK
// (auditoría 2026-08-29) pero se quedó sin test propio hasta Fase A (segunda auditoría,
// 2026-08-30). Lo que hay que proteger: que un logro nunca se desbloquee (ni se anuncie)
// dos veces, apoyado en la constraint única de Postgres (23505), no en un chequeo de
// aplicación.
const supabaseMock = createSupabaseMock();
vi.mock('../src/supabaseClient.js', () => ({ get supabase() { return supabaseMock; } }));

const { unlockAchievement } = await import('../src/utils/achievements.js');
const { eventBus } = await import('../src/utils/eventBus.js');

beforeEach(() => {
  vi.clearAllMocks();
  supabaseMock.getBuilder('achievements_unlocked').__setResult({ data: null, error: null });
});

describe('unlockAchievement', () => {
  it('la primera vez, inserta y devuelve el logro', async () => {
    const achievement = await unlockAchievement('g1', 'u1', 'primera_moneda');
    expect(achievement).toMatchObject({ id: 'primera_moneda' });
  });

  it('un id de logro desconocido tira, en vez de insertar cualquier cosa', async () => {
    await expect(unlockAchievement('g1', 'u1', 'no_existe')).rejects.toThrow();
  });

  it('un segundo intento (constraint única, código 23505) devuelve null en vez de tirar', async () => {
    supabaseMock.getBuilder('achievements_unlocked').__setResult({ data: null, error: { code: '23505' } });

    const achievement = await unlockAchievement('g1', 'u1', 'primera_moneda');
    expect(achievement).toBeNull();
  });

  it('un error que no es de duplicado se propaga tal cual', async () => {
    const dbError = { code: '500', message: 'connection refused' };
    supabaseMock.getBuilder('achievements_unlocked').__setResult({ data: null, error: dbError });

    await expect(unlockAchievement('g1', 'u1', 'primera_moneda')).rejects.toBe(dbError);
  });
});

describe('ACHIEVEMENT_CHECK — handler consolidado', () => {
  it('modo channel+user: manda el embed solo la primera vez', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const channel = { send };
    const user = { tag: 'user#0001' };

    await eventBus.emit('ACHIEVEMENT_CHECK', { guildId: 'g1', userId: 'u2', achievementId: 'anfitrion', channel, user });
    expect(send).toHaveBeenCalledTimes(1);

    // Segunda vez: ya lo tenía (simulamos la constraint única).
    supabaseMock.getBuilder('achievements_unlocked').__setResult({ data: null, error: { code: '23505' } });
    await eventBus.emit('ACHIEVEMENT_CHECK', { guildId: 'g1', userId: 'u2', achievementId: 'anfitrion', channel, user });
    expect(send).toHaveBeenCalledTimes(1); // no subió
  });

  it('modo interaction: hace followUp solo si se desbloqueó recién', async () => {
    const followUp = vi.fn().mockResolvedValue(undefined);
    const interaction = { followUp };

    await eventBus.emit('ACHIEVEMENT_CHECK', { guildId: 'g1', userId: 'u3', achievementId: 'primera_compra', interaction });
    expect(followUp).toHaveBeenCalledTimes(1);

    supabaseMock.getBuilder('achievements_unlocked').__setResult({ data: null, error: { code: '23505' } });
    await eventBus.emit('ACHIEVEMENT_CHECK', { guildId: 'g1', userId: 'u3', achievementId: 'primera_compra', interaction });
    expect(followUp).toHaveBeenCalledTimes(1); // no subió
  });

  it('sin interaction ni channel/user: desbloqueo silencioso, no revienta', async () => {
    await expect(
      eventBus.emit('ACHIEVEMENT_CHECK', { guildId: 'g1', userId: 'u4', achievementId: 'primera_moneda' }),
    ).resolves.toBeUndefined();
  });
});
