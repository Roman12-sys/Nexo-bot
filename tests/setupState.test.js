import { vi, describe, it, expect, beforeEach } from 'vitest';

// NEXO Setup Inteligente, Bloque 15/16 — motor de estado derivado del panel principal.
// Sin ninguna tabla de "progreso" — cada sección se recalcula en vivo contra
// guild_config + Discord, así que estos tests son, en el fondo, la prueba de que
// "reabrir /setup" siempre refleja la realidad en vez de un estado guardado obsoleto.
const hasCustomShopItems = vi.fn();
vi.mock('../src/utils/shopStore.js', () => ({ hasCustomShopItems }));

const { getSetupStatus, countPendingSections, STATUS } = await import('../src/utils/setupState.js');

function makeGuild({ guildId = 'guild-1', permissionsGranted = true } = {}) {
  return {
    id: guildId,
    members: { me: { permissions: { has: () => permissionsGranted } } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('setupState — getSetupStatus', () => {
  it('guild totalmente sin configurar: todo en rojo/amarillo, nada en verde falso', async () => {
    hasCustomShopItems.mockResolvedValue(false);
    const status = await getSetupStatus(makeGuild(), {});

    expect(status.roles.status).toBe(STATUS.ERROR);
    expect(status.moderacion.status).toBe(STATUS.WARN);
    expect(status.bienvenida.status).toBe(STATUS.ERROR);
    expect(status.economia.status).toBe(STATUS.WARN);
    expect(status.casino.status).toBe(STATUS.OK); // casino nunca depende de config — ver el comentario del archivo
  });

  it('guild configurado a fondo: todo en verde', async () => {
    hasCustomShopItems.mockResolvedValue(true);
    const cfg = {
      moderator_role_id: 'role-staff',
      features: { moderacion: true },
      welcome_channel_id: 'chan-welcome',
      welcome_title: '🎉 Bienvenido',
    };
    const status = await getSetupStatus(makeGuild(), cfg);

    expect(status.roles.status).toBe(STATUS.OK);
    expect(status.moderacion.status).toBe(STATUS.OK);
    expect(status.bienvenida.status).toBe(STATUS.OK);
    expect(status.economia.status).toBe(STATUS.OK);
    expect(status.casino.status).toBe(STATUS.OK);
  });

  it('bienvenida: canal configurado pero SIN personalizar es amarillo, no verde ni rojo', async () => {
    hasCustomShopItems.mockResolvedValue(false);
    const status = await getSetupStatus(makeGuild(), { welcome_channel_id: 'chan-1' });
    expect(status.bienvenida.status).toBe(STATUS.WARN);
  });

  it('permisos del bot: refleja getMissingBotPermissions en vivo, sin ningún caché', async () => {
    hasCustomShopItems.mockResolvedValue(true);
    const statusGranted = await getSetupStatus(makeGuild({ permissionsGranted: true }), {});
    expect(statusGranted.permisosBot.status).toBe(STATUS.OK);

    const statusMissing = await getSetupStatus(makeGuild({ permissionsGranted: false }), {});
    expect(statusMissing.permisosBot.status).toBe(STATUS.ERROR);
    expect(statusMissing.permisosBot.missing.length).toBeGreaterThan(0);
  });

  // 2026-09-27 — el caso Cloud6: permisos del servidor completos y 0 canales visibles.
  it('permisos del bot: con todos los permisos pero sin ver ningún canal de texto, es rojo', async () => {
    hasCustomShopItems.mockResolvedValue(true);
    const blind = { type: 0, permissionsFor: () => ({ has: () => false }) };
    const guild = { ...makeGuild(), channels: { cache: new Map([['a', blind], ['b', blind]]) } };

    const status = await getSetupStatus(guild, {});

    expect(status.permisosBot.status).toBe(STATUS.ERROR);
    expect(status.permisosBot.detail).toMatch(/ningún canal/);
  });

  it('permisos del bot: si ve aunque sea un canal, sigue en verde (canales privados del staff son normales)', async () => {
    hasCustomShopItems.mockResolvedValue(true);
    const guild = {
      ...makeGuild(),
      channels: { cache: new Map([['a', { type: 0, permissionsFor: () => ({ has: () => true }) }], ['b', { type: 0, permissionsFor: () => ({ has: () => false }) }]]) },
    };

    const status = await getSetupStatus(guild, {});

    expect(status.permisosBot.status).toBe(STATUS.OK);
  });

  // 2026-09-27 — el caso Prueba bot: el rol automático era el mismo rol de staff.
  it('roles: un rol automático que es también de staff pone la sección en rojo aunque haya rol de staff', async () => {
    hasCustomShopItems.mockResolvedValue(true);
    const status = await getSetupStatus(makeGuild(), { moderator_role_id: 'role-staff', admin_role_id: 'role-staff', auto_role_id: 'role-staff' });

    expect(status.roles.status).toBe(STATUS.ERROR);
    expect(status.roles.detail).toContain('<@&role-staff>');
    expect(status.roles.detail).toMatch(/staff/);
  });

  it('economía: usa hasCustomShopItems(guild.id), no un guildId hardcodeado', async () => {
    hasCustomShopItems.mockResolvedValue(true);
    await getSetupStatus(makeGuild({ guildId: 'guild-especifico' }), {});
    expect(hasCustomShopItems).toHaveBeenCalledWith('guild-especifico');
  });
});

describe('setupState — countPendingSections', () => {
  it('cuenta solo las secciones que NO están en ok', () => {
    const sections = {
      a: { status: STATUS.OK },
      b: { status: STATUS.WARN },
      c: { status: STATUS.ERROR },
      d: { status: STATUS.OK },
    };
    expect(countPendingSections(sections)).toBe(2);
  });

  it('todo en ok: 0 pendientes', () => {
    expect(countPendingSections({ a: { status: STATUS.OK }, b: { status: STATUS.OK } })).toBe(0);
  });
});
