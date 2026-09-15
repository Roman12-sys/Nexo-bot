import { vi, describe, it, expect } from 'vitest';

// buildConfigSummaryEmbed es la parte nueva de /config ver (Fase 1, P3: "resumen de
// /setup desde /config ver") — reemplaza el embed chico de 4 campos por un resumen
// completo de guild_config, para no tener que volver a correr /setup solo para
// chequear qué quedó prendido.
const getGuildConfig = vi.fn();
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig, setGuildConfig: vi.fn() }));

const { buildConfigSummaryEmbed } = await import('../src/commands/admin/config.js');

function fieldValue(embed, name) {
  return embed.data.fields.find((f) => f.name === name)?.value;
}

describe('buildConfigSummaryEmbed', () => {
  it('servidor recién creado (sin /setup todavía): todo aparece como "sin configurar" o apagado', async () => {
    getGuildConfig.mockResolvedValue({
      admin_role_id: null, moderator_role_id: null, punish_role_id: null, auto_role_id: null,
      welcome_channel_id: null, confession_channel_id: null, xp_announce_channel_id: null,
      log_channel_moderation_id: null, log_channel_activity_id: null, log_channel_economy_id: null,
      level_roles: {}, level_roles_mode: 'cumulative', features: {}, setup_completed_at: null,
    });

    const embed = await buildConfigSummaryEmbed('guild-1');

    expect(fieldValue(embed, '👮 Rol de administrador')).toMatch(/sin configurar/);
    expect(fieldValue(embed, '🧩 Moderación')).toMatch(/Apagado/);
    expect(fieldValue(embed, '✨ Roles de nivel')).toMatch(/sin configurar/);
    expect(embed.data.fields.some((f) => f.name.includes('Última vez que se corrió'))).toBe(false);
  });

  it('servidor configurado: roles/canales se muestran como mención, módulos activos en verde', async () => {
    getGuildConfig.mockResolvedValue({
      admin_role_id: 'role-admin', moderator_role_id: 'role-mod', punish_role_id: 'role-punish', auto_role_id: 'role-auto',
      welcome_channel_id: 'chan-welcome', confession_channel_id: 'chan-confession', xp_announce_channel_id: 'chan-xp',
      log_channel_moderation_id: 'chan-log-mod', log_channel_activity_id: 'chan-log-act', log_channel_economy_id: 'chan-log-eco',
      level_roles: { 5: 'role-5', 10: 'role-10' }, level_roles_mode: 'replace',
      features: { moderacion: true, economia: true, xp: false },
      setup_completed_at: '2026-01-01T00:00:00.000Z',
    });

    const embed = await buildConfigSummaryEmbed('guild-1');

    expect(fieldValue(embed, '👮 Rol de administrador')).toBe('<@&role-admin>');
    expect(fieldValue(embed, '📋 Log de moderación')).toBe('<#chan-log-mod>');
    expect(fieldValue(embed, '🧩 Moderación')).toMatch(/Activo/);
    expect(fieldValue(embed, '🧩 XP')).toMatch(/Apagado/);
    expect(fieldValue(embed, '✨ Roles de nivel')).toMatch(/2 configurado\(s\) \(modo: replace\)/);
    expect(embed.data.fields.some((f) => f.name.includes('Última vez que se corrió'))).toBe(true);
  });

  // Tuning de economía por servidor (plan de ejecución 2026-09-15) — describeRange/
  // describePercent marcan "personalizado" vs "por defecto" usando la MISMA resolución
  // que aplican /daily /work /crime /rob, para que el resumen nunca diverja.
  it('sin overrides de economía: el campo "Economía" muestra los defaults globales', async () => {
    getGuildConfig.mockResolvedValue({ features: {}, level_roles: {} });

    const embed = await buildConfigSummaryEmbed('guild-1');

    const economia = fieldValue(embed, '💰 Economía');
    expect(economia).toContain('Diario: 100–300 (por defecto)');
    expect(economia).toContain('Trabajo: 50–150 (por defecto)');
    expect(economia).toContain('Crimen: 150–400 (por defecto), éxito 60% (por defecto)');
    expect(economia).toContain('Robo: éxito 40% (por defecto)');
  });

  it('con overrides de economía: el campo "Economía" marca "personalizado" y usa los valores guardados', async () => {
    getGuildConfig.mockResolvedValue({
      features: {},
      level_roles: {},
      economy_daily_min: 1000,
      economy_daily_max: 2000,
      economy_rob_success_percent: 90,
    });

    const embed = await buildConfigSummaryEmbed('guild-1');

    const economia = fieldValue(embed, '💰 Economía');
    expect(economia).toContain(`Diario: ${(1000).toLocaleString('es-ES')}–${(2000).toLocaleString('es-ES')} (personalizado)`);
    expect(economia).toContain('Robo: éxito 90% (personalizado)');
    expect(economia).toContain('Trabajo: 50–150 (por defecto)'); // sin override propio: sigue en el default
  });
});
