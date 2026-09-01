import { describe, it, expect } from 'vitest';
import { renderGuildDashboard } from '../dashboard/views.js';

// views.js — Fase 2C, sección 2: punishedMembers ahora puede venir recortado (a lo sumo
// 20, ver dashboard/queries.js) con el total real aparte (punishedTotal). Lo que importa
// probar es que el título muestra el TOTAL real (no el largo de la lista recortada) y
// que el indicador "+N más" aparece solo cuando de verdad hay más de lo que se muestra.
function baseData(overrides = {}) {
  return {
    topCommands: [],
    totalCommands: 0,
    unlockedAchievementIds: new Set(),
    topBalances: [],
    totalCoins: 0,
    recentWarns: [],
    totalWarns: 0,
    activeGiveaways: [],
    topTrivia: [],
    punishedMembers: [],
    punishedTotal: 0,
    punishedPossiblyIncomplete: false,
    topXp: [],
    xpUserCount: 0,
    voiceStats: { totalSessions: 0, totalDurationSeconds: 0, peakConcurrent: 0, topOwners: [] },
    topAchievers: [],
    lolChannelId: null,
    lolLastUrl: null,
    lolLastAnnouncedAt: null,
    dailyStats: [],
    messagesDelta: null,
    missionSummary: { dailyCompletedUsers: 0, weeklyCompletedUsers: 0 },
    ...overrides,
  };
}

const guild = { name: 'Server de prueba', approximate_member_count: 100 };

describe('renderGuildDashboard — sancionados recortados (sección 2)', () => {
  it('con más sancionados de los que se listan, muestra el total real en el título y un indicador "+N más"', () => {
    const data = baseData({
      punishedMembers: ['user-1', 'user-2'],
      punishedTotal: 47,
    });

    const html = renderGuildDashboard(guild, data, new Map());

    expect(html).toContain('Sancionados activos (47)');
    expect(html).toContain('(+45 más)');
  });

  it('sin recorte (todos los sancionados listados), no muestra el indicador de más', () => {
    const data = baseData({
      punishedMembers: ['user-1', 'user-2'],
      punishedTotal: 2,
    });

    const html = renderGuildDashboard(guild, data, new Map());

    expect(html).toContain('Sancionados activos (2)');
    expect(html).not.toContain('más)');
  });
});
