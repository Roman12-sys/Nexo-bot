// Infra de testing compartida: una interaction de discord.js "falsa" con la forma
// mínima que los comandos de moderación necesitan (guild.members.fetch/ban, options,
// reply/deferReply/editReply/followUp como vi.fn()). Reusable por cualquier test que
// necesite ejecutar el execute() real de un comando sin un bot conectado de verdad.
import { vi } from 'vitest';

export function makeTargetMember({ id = 'target-1', position = 1, bannable = true, kickable = true, moderatable = true } = {}) {
  return {
    id,
    user: { id, tag: `target-${id}#0001` },
    bannable,
    kickable,
    moderatable,
    roles: { highest: { position } },
  };
}

export function makeInteraction({
  guildId = 'guild-1',
  userId = 'mod-1',
  userPosition = 10,
  staffRoleIds = [],
  ownerId = 'owner-1',
  botId = 'bot-1',
  targetUser = { id: 'target-1', tag: 'target-1#0001' },
  targetMember = makeTargetMember(),
  options = {},
} = {}) {
  const reply = vi.fn().mockResolvedValue(undefined);
  const editReply = vi.fn().mockResolvedValue(undefined);
  const deferReply = vi.fn().mockResolvedValue(undefined);
  const followUp = vi.fn().mockResolvedValue(undefined);
  const update = vi.fn().mockResolvedValue(undefined);

  const guild = {
    id: guildId,
    ownerId,
    members: {
      fetch: vi.fn(async (id) => (targetMember && id === targetMember.id ? targetMember : null)),
      ban: vi.fn().mockResolvedValue(undefined),
    },
  };

  const optionGetters = {
    getUser: (name) => (name === 'usuario' ? targetUser : (options[name] ?? null)),
    getString: (name) => options[name] ?? null,
    getInteger: (name) => (name in options ? options[name] : null),
    getBoolean: (name) => options[name] ?? null,
  };

  return {
    guild,
    guildId,
    user: { id: userId, tag: `mod-${userId}#0001` },
    member: {
      roles: {
        highest: { position: userPosition },
        // Map real (no un objeto ad-hoc con solo .has()): la Collection real de
        // discord.js extiende Map, y permissions.js/isStaff() hace
        // [...roles.cache.keys()] — un objeto con solo .has() rompe con
        // "roles.cache.keys is not a function" apenas algo pasa por isStaff().
        cache: new Map(staffRoleIds.map((id) => [id, { id }])),
      },
    },
    client: { user: { id: botId } },
    options: optionGetters,
    replied: false,
    deferred: false,
    reply,
    editReply,
    deferReply,
    followUp,
    update,
  };
}

// Simula el click en el botón "Confirmar" (o "Cancelar") de un panel de confirmación:
// arma una interaction de botón con el mismo usuario/guild que la original (o los que
// se pasen explícitamente, para simular "otro usuario clickeó"), extrae el customId del
// primer botón de la respuesta capturada, y lo despacha por el router REAL de botones
// (src/components/buttons.js) — así se ejercita confirmations.js de punta a punta, no
// una versión simulada de su lógica.
export function extractButtonCustomId(replyCall, label) {
  const row = replyCall.components?.[0];
  const button = row?.components?.find((b) => b.data?.label === label);
  if (!button) throw new Error(`No se encontró un botón con label "${label}" en la respuesta.`);
  return button.data.custom_id;
}

// `base` es opcional: cuando se pasa (normalmente la interaction original de la que
// salió el panel), el botón hereda guild/member/client — así confirmBan/confirmUnwarn
// pueden revalidar permisos y jerarquía "en fresco" usando exactamente el mismo shape
// que usó el comando original. Sin `base`, sirve para el flujo genérico de
// confirmations.test.js, que no necesita nada de eso.
export function makeButtonInteraction(customId, { userId = 'mod-1', guildId = 'guild-1', base = null } = {}) {
  return {
    ...(base || {}),
    customId,
    guildId,
    user: { id: userId },
    update: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

// Interaction "falsa" para paneles de select menu (ej. /sanciones, /economia-staff) —
// a diferencia de makeInteraction (pensada para slash commands con `options`), acá lo
// que importa es `values` (lo elegido en el menú) y que guild.members.fetch resuelva un
// member "target" puntual, igual que makeInteraction pero sin el wrapper de options.
export function makeSelectInteraction({
  guildId = 'guild-1',
  userId = 'mod-1',
  userPosition = 10,
  staffRoleIds = [],
  ownerId = 'owner-1',
  botId = 'bot-1',
  values = ['target-1'],
  member = null,
} = {}) {
  const guild = {
    id: guildId,
    ownerId,
    members: {
      fetch: vi.fn(async (id) => (member && id === member.id ? member : null)),
      unban: vi.fn().mockResolvedValue(undefined),
    },
  };

  return {
    guild,
    guildId,
    values,
    user: { id: userId, tag: `mod-${userId}#0001` },
    member: {
      roles: {
        highest: { position: userPosition },
        cache: new Map(staffRoleIds.map((id) => [id, { id }])),
      },
    },
    client: {
      user: { id: botId },
      users: { fetch: vi.fn(async (id) => ({ id, tag: `user-${id}#0001` })) },
    },
    channel: { send: vi.fn().mockResolvedValue(undefined) },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
  };
}
