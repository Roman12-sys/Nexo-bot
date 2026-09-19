import { describe, it, expect, vi } from 'vitest';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { scanGuildChannels, groupFindingsByCategory, applyChannelCorrection } from '../src/utils/setupDiagnostics.js';
import { STATUS } from '../src/utils/setupState.js';

// NEXO Setup Inteligente, Bloques 6-9 — diagnóstico de canales. Dos niveles de
// confianza a propósito: canales que NEXO gestiona (certeza real, corregible) vs.
// heurístico por nombre para el resto del servidor (solo aviso, nunca corregible).
function makeOverwrites(entries) {
  const cache = new Map();
  for (const [id, { allow = [], deny = [] }] of entries) {
    cache.set(id, {
      allow: { has: (flag) => allow.includes(flag) },
      deny: { has: (flag) => deny.includes(flag) },
    });
  }
  return { cache };
}

function makeChannel({ id, name, parent = null, overwrites = [] }) {
  return {
    id,
    name,
    type: ChannelType.GuildText,
    parent,
    permissionOverwrites: makeOverwrites(overwrites),
  };
}

function makeGuild({ channels, staffRolePosition = 5, botPosition = 10, hasManageChannels = true }) {
  const everyoneId = 'role-everyone';
  const cache = new Map(channels.map((c) => [c.id, { ...c, guild: null }]));
  for (const c of cache.values()) c.guild = { roles: { everyone: { id: everyoneId } } };

  return {
    roles: {
      everyone: { id: everyoneId },
      cache: new Map([['role-staff', { id: 'role-staff', position: staffRolePosition }]]),
    },
    channels: {
      cache,
      fetch: vi.fn(async (id) => cache.get(id) || null),
    },
    members: {
      me: { permissions: { has: (flag) => (flag === PermissionFlagsBits.ManageChannels ? hasManageChannels : true) }, roles: { highest: { position: botPosition } } },
    },
  };
}

describe('setupDiagnostics — scanGuildChannels: canales gestionados por NEXO (certeza real)', () => {
  it('canal de logs correcto (staff-only, @everyone denegado): sin hallazgos', () => {
    const channel = makeChannel({
      id: 'chan-log',
      name: 'registro-moderacion',
      overwrites: [['role-everyone', { deny: [PermissionFlagsBits.ViewChannel] }], ['role-staff', { allow: [PermissionFlagsBits.ViewChannel] }]],
    });
    const guild = makeGuild({ channels: [channel] });
    const cfg = { log_channel_moderation_id: 'chan-log', moderator_role_id: 'role-staff' };

    const findings = scanGuildChannels(guild, cfg);
    expect(findings).toEqual([]);
  });

  it('canal de logs con @everyone viéndolo: 🔴, corregible', () => {
    const channel = makeChannel({ id: 'chan-log', name: 'registro-moderacion', overwrites: [] }); // sin overwrite = ve por default
    const guild = makeGuild({ channels: [channel] });
    const cfg = { log_channel_moderation_id: 'chan-log', moderator_role_id: 'role-staff' };

    const findings = scanGuildChannels(guild, cfg);
    expect(findings).toHaveLength(1);
    expect(findings[0].status).toBe(STATUS.ERROR);
    expect(findings[0].correctable).toBe(true);
    expect(findings[0].correction).toEqual({ type: 'deny-everyone-view', channelId: 'chan-log' });
  });

  it('canal de logs sin acceso para el rol de staff: 🟡, corregible', () => {
    const channel = makeChannel({
      id: 'chan-log',
      name: 'registro-moderacion',
      overwrites: [['role-everyone', { deny: [PermissionFlagsBits.ViewChannel] }], ['role-staff', { deny: [PermissionFlagsBits.ViewChannel] }]],
    });
    const guild = makeGuild({ channels: [channel] });
    const cfg = { log_channel_moderation_id: 'chan-log', moderator_role_id: 'role-staff' };

    const findings = scanGuildChannels(guild, cfg);
    expect(findings).toHaveLength(1);
    expect(findings[0].status).toBe(STATUS.WARN);
    expect(findings[0].correction).toEqual({ type: 'allow-staff-view', channelId: 'chan-log', roleId: 'role-staff' });
  });

  it('canal de bienvenida (se espera público) con @everyone viéndolo: sin hallazgos', () => {
    const channel = makeChannel({ id: 'chan-welcome', name: 'bienvenida', overwrites: [] });
    const guild = makeGuild({ channels: [channel] });
    const cfg = { welcome_channel_id: 'chan-welcome' };

    expect(scanGuildChannels(guild, cfg)).toEqual([]);
  });
});

describe('setupDiagnostics — scanGuildChannels: heurístico por nombre (canales ajenos)', () => {
  it('canal con nombre "staff-chat" visible para @everyone (no gestionado por NEXO): 🟡, NO corregible', () => {
    const channel = makeChannel({ id: 'chan-x', name: 'staff-chat', overwrites: [] });
    const guild = makeGuild({ channels: [channel] });

    const findings = scanGuildChannels(guild, {});
    expect(findings).toHaveLength(1);
    expect(findings[0].status).toBe(STATUS.WARN);
    expect(findings[0].correctable).toBe(false);
    expect(findings[0].correction).toBeNull();
  });

  it('canal ajeno sin ningún hint de nombre sensible: sin hallazgos', () => {
    const channel = makeChannel({ id: 'chan-x', name: 'general', overwrites: [] });
    const guild = makeGuild({ channels: [channel] });

    expect(scanGuildChannels(guild, {})).toEqual([]);
  });

  it('canal con nombre sensible pero YA privado (deny a @everyone): sin hallazgos', () => {
    const channel = makeChannel({ id: 'chan-x', name: 'logs-internos', overwrites: [['role-everyone', { deny: [PermissionFlagsBits.ViewChannel] }]] });
    const guild = makeGuild({ channels: [channel] });

    expect(scanGuildChannels(guild, {})).toEqual([]);
  });
});

describe('setupDiagnostics — groupFindingsByCategory', () => {
  it('agrupa por categoría, incluida la bolsa "(sin categoría)"', () => {
    const findings = [
      { categoryName: 'STAFF', channelName: 'a' },
      { categoryName: 'STAFF', channelName: 'b' },
      { categoryName: null, channelName: 'c' },
    ];
    const groups = groupFindingsByCategory(findings);
    expect(groups.get('STAFF')).toHaveLength(2);
    expect(groups.get('(sin categoría)')).toHaveLength(1);
  });
});

describe('setupDiagnostics — applyChannelCorrection', () => {
  it('canal borrado: falla explícito, sin tirar', async () => {
    const guild = makeGuild({ channels: [] });
    const result = await applyChannelCorrection(guild, { type: 'deny-everyone-view', channelId: 'no-existe' });
    expect(result).toEqual({ ok: false, reason: 'El canal ya no existe.' });
  });

  it('al bot le falta Gestionar canales: falla explícito', async () => {
    const channel = makeChannel({ id: 'chan-log', name: 'registro-moderacion', overwrites: [] });
    channel.permissionOverwrites.edit = vi.fn();
    const guild = makeGuild({ channels: [channel], hasManageChannels: false });

    const result = await applyChannelCorrection(guild, { type: 'deny-everyone-view', channelId: 'chan-log' });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Gestionar canales/);
  });

  it('NEXO no tiene posición suficiente sobre el rol del overwrite: falla explícito', async () => {
    const channel = makeChannel({ id: 'chan-log', name: 'registro-moderacion', overwrites: [] });
    channel.permissionOverwrites.edit = vi.fn();
    const guild = makeGuild({ channels: [channel], botPosition: 1, staffRolePosition: 5 });

    const result = await applyChannelCorrection(guild, { type: 'allow-staff-view', channelId: 'chan-log', roleId: 'role-staff' });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/posición suficiente/);
  });

  it('caso exitoso: deny-everyone-view aplica el overwrite correcto', async () => {
    const channel = makeChannel({ id: 'chan-log', name: 'registro-moderacion', overwrites: [] });
    channel.permissionOverwrites.edit = vi.fn().mockResolvedValue(undefined);
    const guild = makeGuild({ channels: [channel] });

    const result = await applyChannelCorrection(guild, { type: 'deny-everyone-view', channelId: 'chan-log' });
    expect(result).toEqual({ ok: true });
    expect(channel.permissionOverwrites.edit).toHaveBeenCalledWith(guild.roles.everyone, { ViewChannel: false }, expect.any(Object));
  });

  it('un error real de Discord al aplicar (ej. rate limit) se reporta, nunca tira', async () => {
    const channel = makeChannel({ id: 'chan-log', name: 'registro-moderacion', overwrites: [] });
    channel.permissionOverwrites.edit = vi.fn().mockRejectedValue(new Error('rate limited'));
    const guild = makeGuild({ channels: [channel] });

    const result = await applyChannelCorrection(guild, { type: 'deny-everyone-view', channelId: 'chan-log' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('rate limited');
  });
});
