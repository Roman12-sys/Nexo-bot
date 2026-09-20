import { describe, it, expect, vi } from 'vitest';
import { ChannelType, PermissionFlagsBits, OverwriteType } from 'discord.js';
import { scanGuildChannels, scanGuildRoles, groupFindingsByCategory, applyChannelCorrection } from '../src/utils/setupDiagnostics.js';
import { STATUS } from '../src/utils/setupState.js';

// NEXO Setup Inteligente, Bloques 6-9 — diagnóstico de canales. Dos niveles de
// confianza a propósito: canales que NEXO gestiona (certeza real, corregible) vs.
// heurístico por nombre para el resto del servidor (solo aviso, nunca corregible).
function makeOverwrites(entries) {
  const cache = new Map();
  for (const [id, { allow = [], deny = [], type = OverwriteType.Role }] of entries) {
    cache.set(id, {
      id, // discord.js real lo expone como propiedad, no solo como key del Map — scanDangerousOverwrites lo lee así
      type,
      allow: { has: (flag) => allow.includes(flag) },
      deny: { has: (flag) => deny.includes(flag) },
    });
  }
  return { cache };
}

function makeChannel({ id, name, parent = null, overwrites = [], type = ChannelType.GuildText }) {
  return {
    id,
    name,
    type,
    parent,
    permissionOverwrites: makeOverwrites(overwrites),
  };
}

// `permissionBits`: array de PermissionFlagsBits que el rol tiene A NIVEL BASE (no en un
// overwrite de canal) — usado por scanGuildRoles.
function makeRole(id, { position = 1, permissionBits = [], managed = false, name } = {}) {
  return { id, name: name || id, position, managed, permissions: { has: (flag) => permissionBits.includes(flag) } };
}

function makeGuild({ channels, staffRolePosition = 5, botPosition = 10, hasManageChannels = true, extraRoles = [] }) {
  const everyoneId = 'role-everyone';
  const rolesCache = new Map([['role-staff', makeRole('role-staff', { position: staffRolePosition, name: 'Staff' })], ...extraRoles.map((r) => [r.id, r])]);
  const roles = { everyone: { id: everyoneId }, cache: rolesCache };

  // channel.guild tiene que ser el MISMO objeto `roles` de arriba (con su .cache
  // completo) — scanDangerousOverwrites busca el nombre del rol vía
  // channel.guild.roles.cache.get(...), igual que un Channel real de discord.js.
  const cache = new Map(channels.map((c) => [c.id, { ...c, guild: { id: 'guild-1', roles } }]));

  return {
    id: 'guild-1',
    roles,
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

// Pedido explícito: "revisar todos los canales, todos los permisos, por rol" — a
// diferencia de los bloques de arriba (certeza sobre canales gestionados, heurístico de
// nombre), esto es universal: se aplica a CUALQUIER canal (gestionado o no, de cualquier
// tipo) y reusa getDangerousRolePermission (permissions.js), la misma lista que ya usan
// /setup, /config y /punish — nunca un criterio inventado.
describe('setupDiagnostics — scanGuildChannels: permisos peligrosos en overwrites (todos los canales, todos los roles)', () => {
  it('un rol (no staff) con un permiso peligroso otorgado en un canal CUALQUIERA (no gestionado): 🔴, no corregible', () => {
    const channel = makeChannel({
      id: 'chan-general',
      name: 'general',
      overwrites: [['role-vip', { allow: [PermissionFlagsBits.BanMembers] }]],
    });
    const vipRole = makeRole('role-vip', { name: 'VIP' });
    const guild = makeGuild({ channels: [channel], extraRoles: [vipRole] });

    const findings = scanGuildChannels(guild, {}); // sin ningún canal gestionado por NEXO
    expect(findings).toHaveLength(1);
    expect(findings[0].status).toBe(STATUS.ERROR);
    expect(findings[0].correctable).toBe(false);
    expect(findings[0].summary).toContain('VIP');
    expect(findings[0].summary).toContain('Banear miembros');
  });

  it('@everyone con un permiso peligroso otorgado en un canal: 🔴, menciona "@everyone"', () => {
    const channel = makeChannel({
      id: 'chan-general',
      name: 'general',
      overwrites: [['role-everyone', { allow: [PermissionFlagsBits.ManageMessages] }]],
    });
    const guild = makeGuild({ channels: [channel] });

    const findings = scanGuildChannels(guild, {});
    expect(findings).toHaveLength(1);
    expect(findings[0].summary).toContain('@everyone');
  });

  it('el rol de STAFF con un permiso peligroso en un canal: sin hallazgo (privilegios reales, a propósito)', () => {
    const channel = makeChannel({
      id: 'chan-general',
      name: 'general',
      overwrites: [['role-staff', { allow: [PermissionFlagsBits.BanMembers] }]],
    });
    const guild = makeGuild({ channels: [channel] });

    expect(scanGuildChannels(guild, { moderator_role_id: 'role-staff' })).toEqual([]);
  });

  it('overwrite de un MIEMBRO puntual (no de un rol) con permiso peligroso: sin hallazgo — solo roles cuentan', () => {
    const channel = makeChannel({
      id: 'chan-general',
      name: 'general',
      overwrites: [['user-123', { allow: [PermissionFlagsBits.BanMembers], type: OverwriteType.Member }]],
    });
    const guild = makeGuild({ channels: [channel] });

    expect(scanGuildChannels(guild, {})).toEqual([]);
  });

  it('canal de voz (no solo canales de texto) con un permiso peligroso otorgado: también se detecta', () => {
    const channel = makeChannel({
      id: 'chan-voz',
      name: 'General de voz',
      type: ChannelType.GuildVoice,
      overwrites: [['role-vip', { allow: [PermissionFlagsBits.ManageRoles] }]],
    });
    const guild = makeGuild({ channels: [channel], extraRoles: [makeRole('role-vip', { name: 'VIP' })] });

    const findings = scanGuildChannels(guild, {});
    expect(findings).toHaveLength(1);
    expect(findings[0].channelName).toBe('General de voz');
  });

  it('solo permisos normales (ej. ViewChannel/SendMessages) otorgados: sin hallazgo', () => {
    const channel = makeChannel({
      id: 'chan-general',
      name: 'general',
      overwrites: [['role-vip', { allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }]],
    });
    const guild = makeGuild({ channels: [channel], extraRoles: [makeRole('role-vip', { name: 'VIP' })] });

    expect(scanGuildChannels(guild, {})).toEqual([]);
  });

  it('un canal GESTIONADO por NEXO también pasa por este chequeo, además de sus checks de certeza', () => {
    const channel = makeChannel({
      id: 'chan-log',
      name: 'registro-moderacion',
      overwrites: [
        ['role-everyone', { deny: [PermissionFlagsBits.ViewChannel] }],
        ['role-staff', { allow: [PermissionFlagsBits.ViewChannel] }],
        ['role-vip', { allow: [PermissionFlagsBits.KickMembers] }],
      ],
    });
    const guild = makeGuild({ channels: [channel], extraRoles: [makeRole('role-vip', { name: 'VIP' })] });

    const findings = scanGuildChannels(guild, { log_channel_moderation_id: 'chan-log', moderator_role_id: 'role-staff' });
    expect(findings).toHaveLength(1); // ningún problema de certeza, pero SÍ el overwrite peligroso de VIP
    expect(findings[0].summary).toContain('VIP');
  });
});

describe('setupDiagnostics — scanGuildRoles: permisos peligrosos a nivel de servidor (todos los roles)', () => {
  it('un rol cualquiera (no staff/admin) con un permiso peligroso a nivel base: 🟡', () => {
    const guild = makeGuild({ channels: [], extraRoles: [makeRole('role-vip', { name: 'VIP', permissionBits: [PermissionFlagsBits.BanMembers] })] });

    const findings = scanGuildRoles(guild, {});
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('role');
    expect(findings[0].status).toBe(STATUS.WARN);
    expect(findings[0].roleName).toBe('VIP');
    expect(findings[0].summary).toContain('Banear miembros');
  });

  it('el rol configurado como moderator_role_id: exento, aunque tenga permisos peligrosos', () => {
    const guild = makeGuild({ channels: [], extraRoles: [] }); // role-staff ya viene con position pero sin permissionBits peligrosos por defecto
    guild.roles.cache.set('role-staff', makeRole('role-staff', { name: 'Staff', permissionBits: [PermissionFlagsBits.BanMembers] }));

    expect(scanGuildRoles(guild, { moderator_role_id: 'role-staff' })).toEqual([]);
  });

  it('el rol configurado como admin_role_id: también exento', () => {
    const guild = makeGuild({ channels: [], extraRoles: [makeRole('role-admin', { name: 'Admin', permissionBits: [PermissionFlagsBits.Administrator] })] });

    expect(scanGuildRoles(guild, { admin_role_id: 'role-admin' })).toEqual([]);
  });

  it('un rol "managed" (integración — bot, booster, vínculo externo): exento, Discord lo gestiona solo', () => {
    const guild = makeGuild({
      channels: [],
      extraRoles: [makeRole('role-bot', { name: 'MEE6', managed: true, permissionBits: [PermissionFlagsBits.ManageRoles] })],
    });

    expect(scanGuildRoles(guild, {})).toEqual([]);
  });

  it('un rol sin ningún permiso peligroso: sin hallazgo', () => {
    const guild = makeGuild({ channels: [], extraRoles: [makeRole('role-normal', { name: 'Miembro', permissionBits: [PermissionFlagsBits.SendMessages] })] });

    expect(scanGuildRoles(guild, {})).toEqual([]);
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

  it('los hallazgos de rol (kind: "role") quedan afuera — no tienen categoría de canal', () => {
    const findings = [
      { kind: 'channel', categoryName: 'STAFF', channelName: 'a' },
      { kind: 'role', roleName: 'VIP' },
    ];
    const groups = groupFindingsByCategory(findings);
    expect(groups.get('STAFF')).toHaveLength(1);
    expect([...groups.values()].flat()).toHaveLength(1); // el de rol no aparece en ningún grupo
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
