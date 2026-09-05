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
    guildConfig: {},
    voiceConfig: null,
    systemsStatus: [],
    configIssues: [],
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

// DASH-1, Fase 4B: antes "solo lectura" no aparecía en absoluto dentro de la página real
// del servidor (solo en el login, que un link guardado nunca vuelve a mostrar), y
// checkGuildAccess() ya leía guild_config sin mostrar nada de esa data.
describe('renderGuildDashboard — aviso de solo lectura (DASH-1)', () => {
  it('siempre muestra el aviso de solo lectura, con la referencia a /setup y /config', () => {
    const html = renderGuildDashboard(guild, baseData(), new Map());

    expect(html).toContain('solo lectura');
    expect(html).toContain('/setup');
    expect(html).toContain('/config');
  });
});

describe('renderGuildDashboard — tarjeta de configuración actual (DASH-1)', () => {
  it('sin guild_config (servidor recién agregado): muestra "sin configurar" en vez de romper', () => {
    const html = renderGuildDashboard(guild, baseData({ guildConfig: {} }), new Map());

    expect(html).toContain('Configuración actual');
    expect(html).toContain('sin configurar');
  });

  it('con guild_config real: muestra roles, canales de log y módulos activos', () => {
    const data = baseData({
      guildConfig: {
        admin_role_id: '111111111111111111',
        moderator_role_id: '222222222222222222',
        log_channel_moderation_id: '333333333333333333',
        log_channel_activity_id: '444444444444444444',
        log_channel_economy_id: '555555555555555555',
        features: { moderacion: true, xp: false },
        punish_role_id: '666666666666666666',
        auto_role_id: null,
        welcome_channel_id: null,
        confession_channel_id: null,
      },
    });

    const html = renderGuildDashboard(guild, data, new Map());

    expect(html).toContain('111111111111111111');
    expect(html).toContain('222222222222222222');
    expect(html).toContain('333333333333333333');
    expect(html).toContain('✅ Activo'); // moderación
    expect(html).toContain('❌ Apagado'); // xp
    expect(html).toContain('Siempre activa'); // economía no tiene toggle real
  });

  it('economía nunca se muestra como apagada — no hay toggle real para ese módulo', () => {
    const html = renderGuildDashboard(guild, baseData(), new Map());

    // La tarjeta menciona economía como "siempre activa", nunca con el mismo
    // toggle ✅/❌ que moderación/XP (features.economia no existe en el código real).
    expect(html).toContain('💰 Siempre activa');
  });
});

// Dashboard 2.0 (MEJORA 1/2, CICLO 1) — Resumen (stats + accesos rápidos + actividad
// reciente), estado de sistemas y problemas de configuración.
describe('renderGuildDashboard — Resumen (Dashboard 2.0)', () => {
  it('muestra miembros, sistemas activos y cantidad de problemas', () => {
    const data = baseData({
      systemsStatus: [
        { key: 'economia', label: 'Economía', status: 'ok', detail: 'Siempre activa' },
        { key: 'xp', label: 'XP', status: 'off', detail: 'Apagado' },
      ],
      configIssues: [{ severity: 'warning', title: 'Moderación', detail: 'Sin canal de logs.' }],
    });

    const html = renderGuildDashboard(guild, data, new Map());

    expect(html).toContain('📋 Resumen');
    expect(html).toContain('1/2'); // sistemas activos (solo economía es 'ok')
    expect(html).toContain('Problema detectado'); // singular con 1 solo issue
  });

  it('incluye accesos rápidos que anclan a secciones que existen en la misma página', () => {
    const html = renderGuildDashboard(guild, baseData(), new Map());

    for (const anchorId of ['config', 'moderacion', 'economia', 'xp', 'giveaways', 'tempvoice']) {
      expect(html).toContain(`href="#${anchorId}"`);
      expect(html).toContain(`id="${anchorId}"`);
    }
  });

  it('"Ayuda" solo aparece si config.supportContact está configurado (nunca un link inventado)', () => {
    const html = renderGuildDashboard(guild, baseData(), new Map());
    expect(html).not.toContain('🆘 Ayuda');
  });

  it('muestra actividad reciente reusando recentWarns/activeGiveaways ya cargados (sin queries nuevas)', () => {
    const data = baseData({
      recentWarns: [{ user_id: 'user-1', reason: 'Spam', moderator_id: 'mod-1', created_at: new Date().toISOString() }],
      activeGiveaways: [{ prize: 'Nitro', messageId: 'msg-1' }],
    });

    const html = renderGuildDashboard(guild, data, new Map());

    expect(html).toContain('🕒 Actividad reciente');
    expect(html).toContain('Spam');
    expect(html).toContain('Nitro');
  });

  it('sin actividad reciente: mensaje claro, no una tabla vacía', () => {
    const html = renderGuildDashboard(guild, baseData(), new Map());
    expect(html).toContain('Sin actividad reciente registrada');
  });
});

describe('renderGuildDashboard — problemas de configuración (Dashboard 2.0)', () => {
  it('sin issues: no renderiza la tarjeta de problemas', () => {
    const html = renderGuildDashboard(guild, baseData({ configIssues: [] }), new Map());
    expect(html).not.toContain('Problemas de configuración');
  });

  it('con issues: los lista con severidad, título y detalle', () => {
    const data = baseData({
      configIssues: [
        { severity: 'danger', title: 'Reportes', detail: 'El canal configurado ya no existe.' },
        { severity: 'warning', title: 'Rol automático', detail: 'El rol configurado ya no existe.' },
      ],
    });

    const html = renderGuildDashboard(guild, data, new Map());

    expect(html).toContain('Problemas de configuración (2)');
    expect(html).toContain('🔴 Urgente');
    expect(html).toContain('🟡 Atención');
    expect(html).toContain('Reportes');
    expect(html).toContain('El canal configurado ya no existe.');
  });
});

describe('renderGuildDashboard — estado de sistemas (Dashboard 2.0)', () => {
  it('muestra cada sistema con su badge y detalle', () => {
    const data = baseData({
      systemsStatus: [
        { key: 'economia', label: 'Economía', status: 'ok', detail: 'Siempre activa' },
        { key: 'tempvoice', label: 'Salas de voz temporales', status: 'warning', detail: 'Configuración pendiente' },
      ],
    });

    const html = renderGuildDashboard(guild, data, new Map());

    expect(html).toContain('🧩 Sistemas');
    expect(html).toContain('Salas de voz temporales');
    expect(html).toContain('Configuración pendiente');
    expect(html).toContain('badge-ok');
    expect(html).toContain('badge-warning');
  });
});
