// Reaction-roles (P1 de Fase 4B, evaluado y diferido a propósito — ver CLAUDE.md).
// Panel de botones, no reacciones de emoji literales (ver src/utils/reactionRolePanels.js
// para el porqué). Mismo tier que /config (dueño del servidor o Administrator nativo,
// no isAdmin()): crea un mensaje permanente + una fila de config, igual que el resto de
// comandos que tocan roles/canales de guild_config.
//
// `crear` es un builder interactivo con vista previa en vivo (plan 2026-09-15), mismo
// patrón que src/commands/anuncios/anuncio.js: sesión en memoria por guild+usuario,
// selects nativos de Discord (RoleSelectMenuBuilder/ChannelSelectMenuBuilder) en vez de
// opciones planas del slash command, texto vía modal, un solo render que se re-edita con
// interaction.update() en cada cambio. `eliminar`/`listar` no cambian — el pedido fue
// solo sobre `crear`.
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} from 'discord.js';
import { logConfigChange } from './config.js';
import {
  createReactionRolePanel,
  deleteReactionRolePanel,
  listReactionRolePanels,
  getReactionRolePanel,
  getRoleValidationError,
  buildReactionRolePanelMessage,
} from '../../utils/reactionRolePanels.js';
import { registerButtonPrefix } from '../../components/buttons.js';
import { registerSelectPrefix } from '../../components/selects.js';
import { registerModalPrefix } from '../../components/modals.js';
import { BRAND_COLOR, MAGENTA_COLOR, NEUTRAL_COLOR, BRAND_NAME } from '../../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('rolreacciones')
  .setDescription('Paneles de botones para que los miembros elijan roles solos.')
  .addSubcommand((sub) => sub.setName('crear').setDescription('Abre el constructor de paneles con vista previa en vivo.'))
  .addSubcommand((sub) =>
    sub
      .setName('eliminar')
      .setDescription('Elimina un panel de reaction-roles ya creado.')
      .addStringOption((o) => o.setName('mensaje_id').setDescription('ID del mensaje del panel').setRequired(true)),
  )
  .addSubcommand((sub) => sub.setName('listar').setDescription('Muestra los paneles de reaction-roles activos en este servidor.'))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

// ── Builder interactivo de /rolreacciones crear ──────────────────────────────────

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutos — mismo criterio que anuncio.js

// Draft en memoria, una entrada por (guild, usuario) — mismo motivo que anuncio.js: un
// mensaje efímero ya está scopeado al usuario por Discord (el customId no necesita
// userId), pero la key del Map sí necesita guildId para no pisar la sesión de un admin
// con /rolreacciones abierto en dos servidores a la vez.
const sessions = new Map();

function sessionKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function refreshSession(key, draft) {
  const existing = sessions.get(key);
  if (existing?.timeoutHandle) clearTimeout(existing.timeoutHandle);
  const timeoutHandle = setTimeout(() => sessions.delete(key), SESSION_TTL_MS);
  sessions.set(key, { draft, timeoutHandle });
}

function requireSession(interaction) {
  return sessions.get(sessionKey(interaction.guildId, interaction.user.id)) || null;
}

const SESSION_EXPIRED = '❌ Esta sesión expiró. Iniciá de nuevo con `/rolreacciones crear`.';

function buildBuilderPayload(draft, invokingChannel) {
  const embed = new EmbedBuilder().setColor(MAGENTA_COLOR).setTitle(draft.title || '🎭 Elegí tus roles').setFooter({ text: BRAND_NAME });
  if (draft.description) embed.setDescription(draft.description);

  const rolesText =
    draft.roles.length > 0 ? draft.roles.map((r) => `${r.emoji ? `${r.emoji} ` : ''}<@&${r.roleId}>`).join('\n') : '— todavía no elegiste ningún rol';
  embed.addFields({ name: '🎭 Roles', value: rolesText });
  embed.addFields({ name: '📍 Canal', value: draft.channelId ? `<#${draft.channelId}>` : `${invokingChannel} (donde corriste el comando)` });

  const roleSelect = new RoleSelectMenuBuilder().setCustomId('rrbuilder_roles_select').setPlaceholder('Elegí hasta 5 roles').setMinValues(0).setMaxValues(5);
  if (draft.roles.length > 0) roleSelect.setDefaultRoles(draft.roles.map((r) => r.roleId));

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId('rrbuilder_channel_select')
    .setPlaceholder('Canal donde publicar (por defecto: este)')
    .addChannelTypes(ChannelType.GuildText)
    .setMinValues(0)
    .setMaxValues(1);
  if (draft.channelId) channelSelect.setDefaultChannels(draft.channelId);

  const buttonsRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rrbuilder_content').setLabel('📝 Título/descripción').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('rrbuilder_emojis').setLabel('✏️ Emojis').setStyle(ButtonStyle.Secondary).setDisabled(draft.roles.length === 0),
    new ButtonBuilder().setCustomId('rrbuilder_publish').setLabel('✅ Publicar').setStyle(ButtonStyle.Success).setDisabled(draft.roles.length === 0),
    new ButtonBuilder().setCustomId('rrbuilder_cancel').setLabel('❌ Cancelar').setStyle(ButtonStyle.Danger),
  );

  return {
    content: '**🎭 Constructor de panel de roles** — usá los selectores/botones. Así se ve en vivo:',
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(roleSelect), new ActionRowBuilder().addComponents(channelSelect), buttonsRow],
  };
}

async function startBuilder(interaction) {
  const draft = { title: '', description: '', channelId: null, roles: [] };
  refreshSession(sessionKey(interaction.guildId, interaction.user.id), draft);
  await interaction.reply({ ...buildBuilderPayload(draft, interaction.channel), flags: MessageFlags.Ephemeral });
}

function buildContentModal(draft) {
  const modal = new ModalBuilder().setCustomId('modal_rrbuilder_content').setTitle('Título y descripción del panel');

  const titulo = new TextInputBuilder().setCustomId('titulo').setLabel('Título (vacío = "Elegí tus roles")').setStyle(TextInputStyle.Short).setMaxLength(256).setRequired(false);
  if (draft.title) titulo.setValue(draft.title);

  const descripcion = new TextInputBuilder().setCustomId('descripcion').setLabel('Descripción (opcional)').setStyle(TextInputStyle.Paragraph).setMaxLength(1024).setRequired(false);
  if (draft.description) descripcion.setValue(draft.description);

  modal.addComponents(new ActionRowBuilder().addComponents(titulo), new ActionRowBuilder().addComponents(descripcion));
  return modal;
}

function buildEmojisModal(draft) {
  const modal = new ModalBuilder().setCustomId('modal_rrbuilder_emojis').setTitle('Emoji por rol (opcional)');
  draft.roles.forEach((r, i) => {
    const input = new TextInputBuilder()
      .setCustomId(`emoji_${i}`)
      .setLabel(r.label.slice(0, 45))
      .setStyle(TextInputStyle.Short)
      .setMaxLength(50) // cubre emoji custom <:nombre:id>, no solo unicode
      .setRequired(false);
    if (r.emoji) input.setValue(r.emoji);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  });
  return modal;
}

// Publica el panel y persiste la fila — mismo flujo GIVE-1 (auditoría completa
// 2026-09-11, ya aplicado acá el 2026-09-15): ack inmediato ya hecho por el caller
// (interaction.update ya editó el mensaje a "Publicando..."), postear y RECIÉN DESPUÉS
// guardar son 2 llamadas de red secuenciales — si el guardado falla después de postear,
// se borra el mensaje para no dejar un panel "fantasma" sin fila que lo respalde.
async function publishPanel(interaction, draft, sessionKeyValue) {
  const canal = draft.channelId ? await interaction.guild.channels.fetch(draft.channelId).catch(() => null) : interaction.channel;
  if (!canal) {
    await interaction.editReply({ content: '❌ El canal elegido ya no existe. Elegí otro con el selector y volvé a publicar.' });
    return;
  }

  const panelRoles = draft.roles.map((r) => ({ roleId: r.roleId, label: r.label, emoji: r.emoji || undefined }));
  const { embeds, components } = buildReactionRolePanelMessage({ titulo: draft.title, descripcion: draft.description, roles: panelRoles });

  let message = null;
  let registered = false;
  try {
    message = await canal.send({ embeds, components });
    await createReactionRolePanel(interaction.guildId, canal.id, message.id, panelRoles, interaction.user.id);
    registered = true;
  } catch (error) {
    console.error('❌ Error creando el panel de reaction-roles:', error);
    if (message && !registered) await message.delete().catch(() => {});
    await interaction.editReply({ content: `❌ No se pudo crear el panel en ${canal} — revisá que NEXO tenga permiso para escribir ahí. Probá de nuevo.` });
    return;
  }

  sessions.delete(sessionKeyValue);
  await interaction.editReply({ content: `✅ Panel creado en ${canal} con ${draft.roles.length} rol(es): ${message.url}`, embeds: [], components: [] });
  await logConfigChange(interaction, `🎭 Panel de reaction-roles creado en ${canal} (${draft.roles.length} rol(es))`);
}

registerSelectPrefix('rrbuilder_roles_select', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });

  const selectedRoles = [...i.roles.values()];
  for (const rol of selectedRoles) {
    const validationError = getRoleValidationError(i.guild, rol);
    if (validationError) {
      return i.reply({
        content: `❌ ${rol} ${validationError} — no se puede usar en un panel de reaction-roles. Elegí (o creá) otro rol.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  // Preserva label/emoji de los roles que ya estaban (match por roleId) — reabrir el
  // selector y volver a elegir los mismos roles no debe borrar los emojis ya cargados.
  const previousById = new Map(session.draft.roles.map((r) => [r.roleId, r]));
  session.draft.roles = selectedRoles.map((rol) => previousById.get(rol.id) || { roleId: rol.id, label: rol.name, emoji: '' });

  refreshSession(sessionKey(i.guildId, i.user.id), session.draft);
  await i.update(buildBuilderPayload(session.draft, i.channel));
});

registerSelectPrefix('rrbuilder_channel_select', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });

  session.draft.channelId = i.channels.first()?.id ?? null;
  refreshSession(sessionKey(i.guildId, i.user.id), session.draft);
  await i.update(buildBuilderPayload(session.draft, i.channel));
});

registerButtonPrefix('rrbuilder_content', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
  await i.showModal(buildContentModal(session.draft));
});

registerButtonPrefix('rrbuilder_emojis', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
  if (session.draft.roles.length === 0) {
    return i.reply({ content: '❌ Elegí roles primero con el selector de arriba.', flags: MessageFlags.Ephemeral });
  }
  await i.showModal(buildEmojisModal(session.draft));
});

registerButtonPrefix('rrbuilder_publish', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
  if (session.draft.roles.length === 0) {
    return i.reply({ content: '❌ Elegí al menos un rol antes de publicar.', flags: MessageFlags.Ephemeral });
  }

  await i.update({ content: '🎭 Publicando el panel...', embeds: [], components: [] });
  await publishPanel(i, session.draft, sessionKey(i.guildId, i.user.id));
});

registerButtonPrefix('rrbuilder_cancel', async (i) => {
  sessions.delete(sessionKey(i.guildId, i.user.id));
  await i.update({ content: '❌ Cancelado.', embeds: [], components: [] });
});

registerModalPrefix('modal_rrbuilder_content', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });

  session.draft.title = i.fields.getTextInputValue('titulo');
  session.draft.description = i.fields.getTextInputValue('descripcion');
  refreshSession(sessionKey(i.guildId, i.user.id), session.draft);
  await i.update(buildBuilderPayload(session.draft, i.channel));
});

registerModalPrefix('modal_rrbuilder_emojis', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });

  session.draft.roles.forEach((r, idx) => {
    r.emoji = i.fields.getTextInputValue(`emoji_${idx}`) || '';
  });
  refreshSession(sessionKey(i.guildId, i.user.id), session.draft);
  await i.update(buildBuilderPayload(session.draft, i.channel));
});

// ── /rolreacciones eliminar / listar (sin cambios) ───────────────────────────────

async function handleEliminar(interaction) {
  const messageId = interaction.options.getString('mensaje_id');
  const panel = await getReactionRolePanel(interaction.guildId, messageId);
  if (!panel) {
    await interaction.reply({ content: '❌ No encontré ningún panel de reaction-roles con ese ID de mensaje en este servidor.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Best-effort: si el canal/mensaje ya no existe, se sigue igual con el borrado de la
  // fila — nunca deja el comando a mitad de camino por algo que el staff no controla.
  try {
    const channel = await interaction.guild.channels.fetch(panel.channelId).catch(() => null);
    const message = channel?.isTextBased() ? await channel.messages.fetch(panel.messageId).catch(() => null) : null;
    if (message) {
      const disabledEmbed = new EmbedBuilder()
        .setColor(NEUTRAL_COLOR)
        .setTitle(message.embeds[0]?.title || '🎭 Panel de roles')
        .setDescription('⚠️ Este panel fue eliminado por el staff — los botones ya no funcionan.')
        .setFooter({ text: BRAND_NAME });
      await message.edit({ embeds: [disabledEmbed], components: [] });
    }
  } catch (error) {
    console.error('⚠️ No se pudo editar el mensaje del panel al eliminarlo (se borra la config igual):', error);
  }

  await deleteReactionRolePanel(interaction.guildId, messageId);
  await interaction.reply({ content: '✅ Panel eliminado.', flags: MessageFlags.Ephemeral });
  await logConfigChange(interaction, `🎭 Panel de reaction-roles eliminado (mensaje ${messageId})`);
}

async function handleListar(interaction) {
  const panels = await listReactionRolePanels(interaction.guildId);
  if (panels.length === 0) {
    await interaction.reply({ content: 'ℹ️ Este servidor todavía no tiene paneles de reaction-roles. Creá uno con `/rolreacciones crear`.', flags: MessageFlags.Ephemeral });
    return;
  }

  const embed = new EmbedBuilder().setColor(BRAND_COLOR).setTitle('🎭 Paneles de reaction-roles').setFooter({ text: BRAND_NAME });

  for (const panel of panels) {
    const roleList = panel.roles.map((r) => `<@&${r.roleId}>`).join(', ') || '— sin roles';
    const jumpLink = `https://discord.com/channels/${interaction.guildId}/${panel.channelId}/${panel.messageId}`;
    embed.addFields({ name: `<#${panel.channelId}>`, value: `${roleList}\n[Ir al mensaje](${jumpLink}) • ID: \`${panel.messageId}\`` });
  }

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

export async function execute(interaction) {
  const isOwnerOrAdmin = interaction.guild.ownerId === interaction.user.id || interaction.member.permissions.has(PermissionFlagsBits.Administrator);
  if (!isOwnerOrAdmin) {
    await interaction.reply({ content: '❌ Solo el dueño del servidor o un administrador puede usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  const sub = interaction.options.getSubcommand();
  if (sub === 'crear') return startBuilder(interaction);
  if (sub === 'eliminar') return handleEliminar(interaction);
  if (sub === 'listar') return handleListar(interaction);
}
