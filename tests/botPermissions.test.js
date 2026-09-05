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
