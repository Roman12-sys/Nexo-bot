import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createSupabaseMock } from './helpers/supabaseMock.js';
import { makeInteraction, makeButtonInteraction, makeSelectInteraction } from './helpers/discordMock.js';

// Bug reportado: "/sanciones <usuario> no permite ver correctamente las sanciones que
// tiene ese usuario". tests/sanciones.test.js mockea moderationActionsStore.js ENTERO
// para sus otros casos (confirmación de borrado de warns, jerarquía, etc.) — eso deja
// sin probar la pieza real que hace falta acá: ¿la query real (guild_id/user_id/
// order/limit) + el mapeo de filas de Supabase realmente producen el embed correcto?
// Este archivo NO mockea moderationActionsStore.js — corre la función real
// (getUserModerationActions/recordModerationAction) contra un supabase mockeado, el
// mismo patrón que shopAdmin.test.js usa para shopStore.js. Solo se separa en un
// archivo aparte por el mismo motivo que shopAdmin/shopAdminCommand: vi.mock no puede
// convivir "real" y "mockeado" del mismo módulo en el mismo archivo.
const supabaseMock = createSupabaseMock();
vi.mock('../src/supabaseClient.js', () => ({ get supabase() { return supabaseMock; } }));

const getGuildConfig = vi.fn();
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig }));

const getGuildLogChannel = vi.fn().mockResolvedValue(null);
vi.mock('../src/utils/guildLogChannels.js', () => ({ getGuildLogChannel }));

const { execute } = await import('../src/commands/moderacion/sanciones.js');
const { routeButton } = await import('../src/components/buttons.js');

const STAFF_CFG = { admin_role_id: 'role-admin', moderator_role_id: null };

function makeTargetUser(id = 'target-1', tag = 'target-1#0001') {
  return { id, tag, displayAvatarURL: () => 'https://example.com/avatar.png' };
}

// Fila cruda tal cual la devolvería Supabase (snake_case) — lo que
// recordModerationAction realmente inserta y getUserModerationActions realmente lee.
function makeRawRow({ actionType = 'ban', moderatorId = 'mod-1', reason = 'raid', extra = {}, createdAt = new Date().toISOString() } = {}) {
  return { action_type: actionType, moderator_id: moderatorId, reason, extra, created_at: createdAt };
}

beforeEach(() => {
  vi.clearAllMocks();
  getGuildConfig.mockResolvedValue(STAFF_CFG);
  getGuildLogChannel.mockResolvedValue(null);
  supabaseMock.getBuilder('moderation_actions').__setResult({ data: [], error: null });
});

describe('/sanciones <usuario> — pipeline real (store real, sin mockear moderationActionsStore.js)', () => {
  it('Caso 1 — usuario CON sanciones reales: la fila que Supabase devuelve llega tal cual al embed', async () => {
    supabaseMock.getBuilder('moderation_actions').__setResult({
      data: [makeRawRow({ actionType: 'ban', moderatorId: 'mod-9', reason: 'raid en el canal general' })],
      error: null,
    });
    const interaction = makeInteraction({ staffRoleIds: ['role-admin'], targetUser: makeTargetUser() });

    await execute(interaction);

    // Prueba real de que la query se armó bien: guild_id + user_id correctos.
    const builder = supabaseMock.getBuilder('moderation_actions');
    expect(builder.eq).toHaveBeenCalledWith('guild_id', interaction.guildId);
    expect(builder.eq).toHaveBeenCalledWith('user_id', 'target-1');

    const payload = interaction.editReply.mock.calls[0][0];
    const embed = payload.embeds[0];
    expect(embed.data.description).toBeUndefined(); // no debe quedar el texto de "sin sanciones"
    expect(embed.data.fields).toHaveLength(1);
    expect(embed.data.fields[0].name).toContain('🔨 Ban');
    expect(embed.data.fields[0].value).toContain('raid en el canal general');
    expect(embed.data.fields[0].value).toContain('mod-9');
  });

  it('Caso 2 — usuario SIN sanciones: responde con el mensaje correcto de "0 resultados", no un error ni un embed vacío mudo', async () => {
    supabaseMock.getBuilder('moderation_actions').__setResult({ data: [], error: null });
    const interaction = makeInteraction({ staffRoleIds: ['role-admin'], targetUser: makeTargetUser() });

    await execute(interaction);

    const embed = interaction.editReply.mock.calls[0][0].embeds[0];
    expect(embed.data.fields).toBeUndefined();
    expect(embed.data.description).toContain('no tiene sanciones registradas');
  });

  it('Caso 3 — usuario no resoluble en el paginado del historial (sanciones_hist_page_): responde controlado, sin excepción', async () => {
    const interaction = makeButtonInteraction('sanciones_hist_page_1_usuario-borrado', {
      base: {
        guildId: 'guild-1',
        member: { roles: { cache: new Map([['role-admin', { id: 'role-admin' }]]) } },
        client: { users: { fetch: vi.fn().mockResolvedValue(null) } },
        deferUpdate: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
      },
    });

    await expect(routeButton(interaction)).resolves.not.toThrow();

    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('No se pudo encontrar a ese usuario') }));
  });

  it('Caso 4 — aislamiento multi-guild: cada ejecución filtra por SU guildId real, nunca el de otro server', async () => {
    supabaseMock.getBuilder('moderation_actions').__setResult({ data: [makeRawRow()], error: null });

    const inGuildA = makeInteraction({ guildId: 'guild-a', staffRoleIds: ['role-admin'], targetUser: makeTargetUser('same-user') });
    await execute(inGuildA);

    const inGuildB = makeInteraction({ guildId: 'guild-b', staffRoleIds: ['role-admin'], targetUser: makeTargetUser('same-user') });
    await execute(inGuildB);

    const builder = supabaseMock.getBuilder('moderation_actions');
    expect(builder.eq).toHaveBeenCalledWith('guild_id', 'guild-a');
    expect(builder.eq).toHaveBeenCalledWith('guild_id', 'guild-b');
  });

  it('Caso 5 — múltiples sanciones: lista TODAS las que corresponden a la página, con paginación cuando hay más de 5', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => makeRawRow({ actionType: i % 2 === 0 ? 'ban' : 'kick', reason: `motivo-${i}` }));
    supabaseMock.getBuilder('moderation_actions').__setResult({ data: rows, error: null });
    const interaction = makeInteraction({ staffRoleIds: ['role-admin'], targetUser: makeTargetUser() });

    await execute(interaction);

    const payload = interaction.editReply.mock.calls[0][0];
    expect(payload.embeds[0].data.fields).toHaveLength(5); // HISTORIAL_PAGE_SIZE
    expect(payload.embeds[0].data.footer.text).toContain('7 acción(es)');
    expect(payload.components).toHaveLength(1); // fila de paginación, porque hay más de 5
  });

  // Root cause del reporte de bug: /sanciones consulta EXCLUSIVAMENTE moderation_actions
  // (ban/kick/timeout/punish) — /warn escribe en la tabla `warnings`, aparte, consultada
  // solo por /warns (ver warnsStore.js). Un usuario con advertencias pero sin ninguna
  // sanción real de moderation_actions SIEMPRE va a ver "no tiene sanciones registradas"
  // acá, aunque /warns sí le muestre advertencias — comportamiento intencional (mismo
  // footer lo aclara: "No incluye advertencias, usá /warns"), no un defecto de la query.
  it('un usuario con SOLO advertencias (/warn, tabla aparte) sigue mostrando "sin sanciones" acá — comportamiento intencional, no un bug de la query', async () => {
    // moderation_actions vacío porque /warn nunca escribe ahí — esto es justo lo que
    // pasaría después de un /warn real, sin ningún ban/kick/timeout/punish de por medio.
    supabaseMock.getBuilder('moderation_actions').__setResult({ data: [], error: null });
    const interaction = makeInteraction({ staffRoleIds: ['role-admin'], targetUser: makeTargetUser() });

    await execute(interaction);

    const embed = interaction.editReply.mock.calls[0][0].embeds[0];
    expect(embed.data.description).toContain('no tiene sanciones registradas');
    expect(embed.data.footer.text).toContain('No incluye advertencias, usá /warns');
  });

  it('Caso 6 — interacción posterior: el botón "Siguiente" sobre ese mismo historial sigue funcionando y trae el resto de las filas reales', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => makeRawRow({ actionType: 'ban', reason: `motivo-${i}` }));
    supabaseMock.getBuilder('moderation_actions').__setResult({ data: rows, error: null });

    const pageButton = makeButtonInteraction('sanciones_hist_page_1_target-1', {
      base: {
        guildId: 'guild-1',
        member: { roles: { cache: new Map([['role-admin', { id: 'role-admin' }]]) } },
        client: { users: { fetch: vi.fn().mockResolvedValue(makeTargetUser()) } },
        deferUpdate: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
      },
    });

    await routeButton(pageButton);

    const payload = pageButton.editReply.mock.calls[0][0];
    expect(payload.embeds[0].data.fields).toHaveLength(2); // las 2 restantes de la página 2
    expect(payload.embeds[0].data.fields.every((f) => f.value.includes('motivo-'))).toBe(true);
  });
});
