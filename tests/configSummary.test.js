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
});
