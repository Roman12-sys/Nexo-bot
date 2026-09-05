import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeInteraction as makeModerationInteraction } from './helpers/discordMock.js';

// PERM-1, Fase 4B — matriz obligatoria de permisos (sección 11 del spec): confirma
// contra el execute() REAL de un comando de moderación (/warn), /economia-staff y /xp
// que la separación admin/moderador se comporta EXACTAMENTE así:
//
//   Configuración          | Moderación | Economía Staff | XP Staff
//   -----------------------|------------|-----------------|----------
//   antigua (mismo rol)    |     Sí     |       Sí        |    Sí
//   separado + Moderator   |     Sí     |       No        |    No
//   separado + Admin       |     Sí     |       Sí        |    Sí
//
// No mockea isStaff/isAdmin — corren de verdad contra guildConfigStore mockeado, para
// probar el gate real de cada comando, no una versión simulada de la lógica.
const getGuildConfig = vi.fn();
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig }));

const addWarn = vi.fn().mockResolvedValue([{ reason: 'test', moderatorId: 'mod-1' }]);
vi.mock('../src/utils/warnsStore.js', () => ({ addWarn, getGuildFrequentWarnReasons: vi.fn() }));

const getGuildLogChannel = vi.fn().mockResolvedValue(null);
vi.mock('../src/utils/guildLogChannels.js', () => ({ getGuildLogChannel }));

const { execute: warnExecute } = await import('../src/commands/moderacion/warn.js');
const { execute: economiaStaffExecute } = await import('../src/commands/moderacion/economiaStaff.js');
const { execute: xpStaffExecute } = await import('../src/commands/moderacion/xpStaff.js');

// economiaStaffExecute/xpStaffExecute: se usa un subcomando que NO matchea ningún
// handler real — el objetivo es aislar el gate de permisos (lo único que PERM-1 tocó
// en estos dos archivos), no volver a probar handleAdjust/handleSet (lógica de negocio
// sin cambios, ya cubierta en economiaStaffPanel.test.js). Con el gate abierto y ningún
// `if (sub === ...)` matcheando, execute() termina sin llamar a reply/editReply nunca —
// esa ausencia de reply es justamente la señal de "pasó el gate".
function makeStaffCommandInteraction({ guildId = 'guild-1', userId = 'user-1', staffRoleIds = [] } = {}) {
  return {
    guild: { id: guildId },
    guildId,
    user: { id: userId, tag: `user-${userId}#0001` },
    member: { roles: { cache: new Map(staffRoleIds.map((id) => [id, { id }])) } },
    options: { getSubcommand: () => '__no_handler_matches__' },
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Matriz de permisos PERM-1', () => {
  it('Configuración antigua (admin_role_id === moderator_role_id): las 3 superficies permiten acceso', async () => {
    getGuildConfig.mockResolvedValue({ admin_role_id: 'role-staff-unico', moderator_role_id: 'role-staff-unico' });

    const modInteraction = makeModerationInteraction({ staffRoleIds: ['role-staff-unico'], options: { motivo: 'spam' } });
    await warnExecute(modInteraction);
    expect(modInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Se advirtió') }));

    const ecoInteraction = makeStaffCommandInteraction({ staffRoleIds: ['role-staff-unico'] });
    await economiaStaffExecute(ecoInteraction);
    expect(ecoInteraction.reply).not.toHaveBeenCalled(); // gate pasó — no rebotó con "No tenés permisos"

    const xpInteraction = makeStaffCommandInteraction({ staffRoleIds: ['role-staff-unico'] });
    await xpStaffExecute(xpInteraction);
    expect(xpInteraction.reply).not.toHaveBeenCalled();
  });

  it('Admin separado + usuario Moderator: Moderación sí, Economía Staff NO, XP Staff NO', async () => {
    getGuildConfig.mockResolvedValue({ admin_role_id: 'role-admin', moderator_role_id: 'role-mod' });

    const modInteraction = makeModerationInteraction({ staffRoleIds: ['role-mod'], options: { motivo: 'spam' } });
    await warnExecute(modInteraction);
    expect(modInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Se advirtió') }));

    const ecoInteraction = makeStaffCommandInteraction({ staffRoleIds: ['role-mod'] });
    await economiaStaffExecute(ecoInteraction);
    expect(ecoInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No tenés permisos') }));

    const xpInteraction = makeStaffCommandInteraction({ staffRoleIds: ['role-mod'] });
    await xpStaffExecute(xpInteraction);
    expect(xpInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No tenés permisos') }));
  });

  it('Admin separado + usuario Admin: las 3 superficies permiten acceso (Tier 2 incluye Tier 1)', async () => {
    getGuildConfig.mockResolvedValue({ admin_role_id: 'role-admin', moderator_role_id: 'role-mod' });

    // El usuario admin tiene SOLO el rol de administrador (no el de moderador) — prueba
    // que isStaffFromRoleIds() ya lo cubre solo (OR contra admin_role_id), sin que haga
    // falta asignarle también moderator_role_id a mano.
    const modInteraction = makeModerationInteraction({ staffRoleIds: ['role-admin'], options: { motivo: 'spam' } });
    await warnExecute(modInteraction);
    expect(modInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Se advirtió') }));

    const ecoInteraction = makeStaffCommandInteraction({ staffRoleIds: ['role-admin'] });
    await economiaStaffExecute(ecoInteraction);
    expect(ecoInteraction.reply).not.toHaveBeenCalled();

    const xpInteraction = makeStaffCommandInteraction({ staffRoleIds: ['role-admin'] });
    await xpStaffExecute(xpInteraction);
    expect(xpInteraction.reply).not.toHaveBeenCalled();
  });
});
