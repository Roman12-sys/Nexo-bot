import { describe, it, expect } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import { ESSENTIAL_BOT_PERMISSIONS, getMissingBotPermissions, essentialPermissionsBitfield } from '../src/utils/botPermissions.js';

function makeGuild(grantedFlags) {
  const granted = grantedFlags.reduce((acc, f) => acc | f, 0n);
  return { members: { me: { permissions: { has: (flag) => (granted & flag) === flag } } } };
}

describe('getMissingBotPermissions', () => {
  it('con todos los permisos esenciales concedidos: no falta nada', () => {
    const guild = makeGuild(ESSENTIAL_BOT_PERMISSIONS.map((p) => p.flag));

    expect(getMissingBotPermissions(guild)).toEqual([]);
  });

  it('con un permiso esencial faltante: lo devuelve con su label y feature afectada', () => {
    const allExceptManageRoles = ESSENTIAL_BOT_PERMISSIONS.filter((p) => p.flag !== PermissionFlagsBits.ManageRoles).map((p) => p.flag);
    const guild = makeGuild(allExceptManageRoles);

    const missing = getMissingBotPermissions(guild);

    expect(missing).toHaveLength(1);
    expect(missing[0].label).toBe('Gestionar roles');
    expect(missing[0].feature).toContain('/setup');
  });

  it('sin ningún permiso concedido: devuelve la lista completa', () => {
    const guild = makeGuild([]);

    expect(getMissingBotPermissions(guild)).toHaveLength(ESSENTIAL_BOT_PERMISSIONS.length);
  });

  it('sin guild.members.me (nunca debería pasar en producción): no revienta, devuelve []', () => {
    expect(getMissingBotPermissions({ members: {} })).toEqual([]);
    expect(getMissingBotPermissions({})).toEqual([]);
    expect(getMissingBotPermissions(null)).toEqual([]);
    expect(getMissingBotPermissions(undefined)).toEqual([]);
  });
});

describe('essentialPermissionsBitfield', () => {
  it('devuelve el OR de todos los flags esenciales, como string decimal', () => {
    const expected = ESSENTIAL_BOT_PERMISSIONS.reduce((acc, p) => acc | p.flag, 0n).toString();

    expect(essentialPermissionsBitfield()).toBe(expected);
  });

  it('el bitfield resultante efectivamente contiene cada permiso esencial (round-trip)', () => {
    const bitfield = BigInt(essentialPermissionsBitfield());

    for (const { flag } of ESSENTIAL_BOT_PERMISSIONS) {
      expect((bitfield & flag) === flag).toBe(true);
    }
  });
});

// 2026-09-27 — el caso Cloud6: permisos del servidor completos, 0 canales visibles.
describe('getBotChannelVisibility / describeChannelVisibility', () => {
  const channel = (type, canView) => ({ type, permissionsFor: () => ({ has: (flag) => flag === PermissionFlagsBits.ViewChannel && canView }) });
  const guildWith = (channels) => ({ members: { me: {} }, channels: { cache: new Map(channels.map((c, i) => [String(i), c])) } });

  it('cuenta solo canales de texto y anuncios (0 y 5), no voz ni categorías', async () => {
    const { getBotChannelVisibility } = await import('../src/utils/botPermissions.js');
    const guild = guildWith([channel(0, true), channel(5, false), channel(2, true), channel(4, true)]);
    expect(getBotChannelVisibility(guild)).toEqual({ visible: 1, total: 2 });
  });

  // Cloud6 después de /setup: NEXO vería sus propios canales de logs (los crea él) y el
  // conteo diría "ve 3 de 19" sin ver ni un canal de la comunidad.
  it('con cfg, no cuenta los canales de NEXO (logs configurados ni lo que está en su categoría)', async () => {
    const { getBotChannelVisibility } = await import('../src/utils/botPermissions.js');
    const own = (id, parentId = null) => ({ ...channel(0, true), id, parentId });
    const guild = {
      members: { me: {} },
      channels: {
        cache: new Map([
          ['log-mod', own('log-mod', 'cat-nexo')],
          ['log-act', own('log-act')],
          ['bienvenida', own('bienvenida', 'cat-nexo')],
          ['general', { ...channel(0, false), id: 'general', parentId: 'cat-comunidad' }],
          ['memes', { ...channel(0, false), id: 'memes', parentId: 'cat-comunidad' }],
        ]),
      },
    };
    const cfg = { log_channel_activity_id: 'log-act', setup_category_id: 'cat-nexo' };

    expect(getBotChannelVisibility(guild, cfg)).toEqual({ visible: 0, total: 2 });
    expect(getBotChannelVisibility(guild)).toEqual({ visible: 3, total: 5 });
  });

  it('sin bot o sin cache de canales: null (desconocido, nunca "0 de 0")', async () => {
    const { getBotChannelVisibility } = await import('../src/utils/botPermissions.js');
    expect(getBotChannelVisibility(null)).toBeNull();
    expect(getBotChannelVisibility({ members: {}, channels: { cache: new Map() } })).toBeNull();
    expect(getBotChannelVisibility({ members: { me: {} } })).toBeNull();
  });

  it('describeChannelVisibility: rojo solo cuando no ve ninguno; nada que decir sin canales', async () => {
    const { describeChannelVisibility } = await import('../src/utils/botPermissions.js');
    expect(describeChannelVisibility({ visible: 0, total: 16 })).toMatch(/^🔴.*ninguno de los 16/);
    expect(describeChannelVisibility({ visible: 0, total: 1 })).toMatch(/^🔴.*el único canal/);
    expect(describeChannelVisibility({ visible: 3, total: 16 })).toMatch(/^👁️ NEXO ve 3 de 16/);
    expect(describeChannelVisibility({ visible: 16, total: 16 })).toBe('👁️ NEXO ve los 16 canales de texto.');
    expect(describeChannelVisibility({ visible: 0, total: 0 })).toBeNull();
    expect(describeChannelVisibility(null)).toBeNull();
  });
});
