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
        cache: { has: (id) => staffRoleIds.includes(id) },
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
