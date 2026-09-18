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
//
// Auditoría NEXO V (2026-09-18) + feedback en vivo del mismo día sumaron: defer en
// `eliminar`, lock en publicar, revalidación de roles justo antes de publicar, un
// selector de emoji (Components V2 — LabelBuilder + StringSelectMenuBuilder DENTRO de un
// modal, soporte muy nuevo de Discord, discord.js 14.27) con los emojis custom del
// servidor, un campo manual de respaldo cuando el emoji que quieren no está en esa
// lista, e importar el panel completo pegando un JSON.
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
  LabelBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
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
  isValidEmojiInput,
  extractCustomEmojiId,
  MAX_ROLES_PER_PANEL,
} from '../../utils/reactionRolePanels.js';
import { registerButtonPrefix } from '../../components/buttons.js';
import { registerSelectPrefix } from '../../components/selects.js';
import { registerModalPrefix } from '../../components/modals.js';
import { withLock } from '../../utils/asyncLock.js';
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
// con /rolreacciones abierto en dos servidores a la vez. `ownerInteraction` es la
// interacción de comando original que abrió el builder — su token sigue siendo válido
// para editReply() durante 15 minutos, más que suficiente para el TTL de la sesión; se
// usa para (a) invalidar un builder viejo si el mismo admin abre uno nuevo sin terminar
// el anterior, y (b) refrescar la vista después de un modal encadenado desde otro modal,
// donde no hay garantía de que interaction.update() siga apuntando al mensaje correcto.
const sessions = new Map();

function sessionKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function refreshSession(key, draft, ownerInteraction) {
  const existing = sessions.get(key);
  if (existing?.timeoutHandle) clearTimeout(existing.timeoutHandle);
  const timeoutHandle = setTimeout(() => sessions.delete(key), SESSION_TTL_MS);
  sessions.set(key, { draft, timeoutHandle, ownerInteraction: ownerInteraction ?? existing?.ownerInteraction ?? null });
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

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId('rrbuilder_roles_select')
    .setPlaceholder(`Elegí hasta ${MAX_ROLES_PER_PANEL} roles`)
    .setMinValues(0)
    .setMaxValues(MAX_ROLES_PER_PANEL);
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
    new ButtonBuilder().setCustomId('rrbuilder_json').setLabel('📄 JSON').setStyle(ButtonStyle.Secondary),
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
  const key = sessionKey(interaction.guildId, interaction.user.id);
  const existing = sessions.get(key);
  const draft = { title: '', description: '', channelId: null, roles: [] };
  refreshSession(key, draft, interaction);
  await interaction.reply({ ...buildBuilderPayload(draft, interaction.channel), flags: MessageFlags.Ephemeral });

  // Si ya había un builder sin terminar para este mismo admin, invalidarlo — sin esto la
  // key del Map (guild+usuario, no por-mensaje) queda compartida entre los dos mensajes
  // efímeros y "el que se toca último" pisa en silencio el draft del otro (auditoría
  // NEXO V, 2026-09-18).
  if (existing?.ownerInteraction) {
    await existing.ownerInteraction
      .editReply({ content: '❌ Se abrió un constructor nuevo — este quedó invalidado.', embeds: [], components: [] })
      .catch(() => {});
  }
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

// ── Selector de emoji (Components V2) ────────────────────────────────────────────
//
// Un LabelBuilder por rol envolviendo un StringSelectMenu — Discord renderiza el
// desplegable con búsqueda nativa (tipeás para filtrar), así que buscar entre los
// emojis custom del servidor sin salir del bot queda resuelto por la UI nativa, no por
// nada que el bot dibuje. Opciones por select (máximo real de Discord: 25):
// "🚫 Sin emoji", "✏️ Escribir manualmente..." + hasta 23 emojis custom del servidor
// (ordenados por nombre — si el server tiene más de 23, los primeros 23 solamente; para
// cualquier otro hace falta el campo manual). Unicode libre (😀, etc.) no entra en la
// lista por el límite de 25 opciones — ese caso también cae en "Escribir manualmente".
//
// Elegir "Escribir manualmente" encadena un SEGUNDO modal (showModal llamado desde
// DENTRO del submit de este) — soporte de Discord demasiado nuevo como para dar por
// sentado que interaction.update() en ese segundo modal siga apuntando al mensaje
// correcto; ver el comentario en el handler de modal_rrbuilder_emoji_manual_.
async function buildEmojiPickerModal(guild, draft) {
  const guildEmojis = [...(await guild.emojis.fetch().catch(() => guild.emojis.cache)).values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 23);

  const modal = new ModalBuilder().setCustomId('modal_rrbuilder_emoji_pick').setTitle('Emoji por rol (opcional)');

  draft.roles.forEach((r, idx) => {
    const currentCustomEmojiId = extractCustomEmojiId(r.emoji);
    const isManualFallback = Boolean(r.emoji) && !currentCustomEmojiId;

    const options = [
      new StringSelectMenuOptionBuilder().setLabel('🚫 Sin emoji').setValue('__none__').setDefault(!r.emoji),
      new StringSelectMenuOptionBuilder().setLabel('✏️ Escribir manualmente...').setValue('__manual__').setDefault(isManualFallback),
      ...guildEmojis.map((emoji) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(emoji.name.slice(0, 100))
          .setValue(emoji.id)
          .setEmoji({ id: emoji.id, name: emoji.name, animated: emoji.animated })
          .setDefault(emoji.id === currentCustomEmojiId),
      ),
    ];

    const select = new StringSelectMenuBuilder().setCustomId(`emoji_pick_${idx}`).setMinValues(1).setMaxValues(1).addOptions(options);
    const label = new LabelBuilder().setLabel(r.label.slice(0, 45)).setStringSelectMenuComponent(select);
    modal.addLabelComponents(label);
  });

  return modal;
}

function buildManualEmojiModal(draft, roleIndexes) {
  const modal = new ModalBuilder().setCustomId(`modal_rrbuilder_emoji_manual_${roleIndexes.join('-')}`).setTitle('Emoji por rol — texto manual');
  roleIndexes.forEach((idx) => {
    const r = draft.roles[idx];
    const input = new TextInputBuilder()
      .setCustomId(`emoji_manual_${idx}`)
      .setLabel(r.label.slice(0, 45))
      .setStyle(TextInputStyle.Short)
      .setMaxLength(50) // cubre emoji custom <a?:nombre:id>, no solo unicode
      .setRequired(false);
    if (r.emoji) input.setValue(r.emoji);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  });
  return modal;
}

function buildJsonModal() {
  const modal = new ModalBuilder().setCustomId('modal_rrbuilder_json').setTitle('Importar panel desde JSON');
  const jsonInput = new TextInputBuilder()
    .setCustomId('json')
    .setLabel('JSON del panel')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(4000)
    .setPlaceholder('{"titulo":"Elegí tus roles","roles":[{"rol":"ID_DEL_ROL","emoji":"🎮","etiqueta":"Gamer"}]}')
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(jsonInput));
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

  // Revalidación en fresco justo antes de publicar (auditoría NEXO V, 2026-09-18): un rol
  // puede haberse vuelto peligroso, o NEXO puede haber perdido posición/permiso, entre
  // elegirlo en el selector (hasta 10 min de TTL de sesión) y este momento. El toggle real
  // (reactionRolePanels.js) ya revalida en cada click y por eso esto nunca fue
  // explotable — pero sin este chequeo el panel nacía roto desde el día uno sin que el
  // admin se enterara al publicar.
  for (const r of draft.roles) {
    const role = interaction.guild.roles.cache.get(r.roleId) || (await interaction.guild.roles.fetch(r.roleId).catch(() => null));
    if (!role) {
      await interaction.editReply({ content: `❌ El rol "${r.label}" ya no existe en el servidor. Abrí el selector de roles de nuevo y volvé a elegir.` });
      return;
    }
    const validationError = getRoleValidationError(interaction.guild, role);
    if (validationError) {
      await interaction.editReply({ content: `❌ ${role} ${validationError} — no se puede publicar así. Abrí el selector de roles y sacalo.` });
      return;
    }
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
  const modal = await buildEmojiPickerModal(i.guild, session.draft);
  await i.showModal(modal);
});

registerButtonPrefix('rrbuilder_json', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
  await i.showModal(buildJsonModal());
});

registerButtonPrefix('rrbuilder_publish', async (i) => {
  // Sin esto, dos clicks casi simultáneos sobre "Publicar" (antes de que el primer
  // i.update() alcance a quitar el botón) corrían el handler completo dos veces sobre el
  // mismo draft — dos mensajes con paneles idénticos (auditoría NEXO V, 2026-09-18).
  await withLock(`rolreacciones-publish:${i.guildId}:${i.user.id}`, async () => {
    const session = requireSession(i);
    if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
    if (session.draft.roles.length === 0) {
      return i.reply({ content: '❌ Elegí al menos un rol antes de publicar.', flags: MessageFlags.Ephemeral });
    }

    await i.update({ content: '🎭 Publicando el panel...', embeds: [], components: [] });
    await publishPanel(i, session.draft, sessionKey(i.guildId, i.user.id));
  });
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

registerModalPrefix('modal_rrbuilder_emoji_pick', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });

  const manualIndexes = [];
  session.draft.roles.forEach((r, idx) => {
    const [choice] = i.fields.getStringSelectValues(`emoji_pick_${idx}`);
    if (choice === '__manual__') {
      manualIndexes.push(idx);
    } else if (choice === '__none__') {
      r.emoji = '';
    } else {
      const emoji = i.guild.emojis.cache.get(choice);
      r.emoji = emoji ? emoji.toString() : '';
    }
  });

  refreshSession(sessionKey(i.guildId, i.user.id), session.draft);

  if (manualIndexes.length > 0) {
    await i.showModal(buildManualEmojiModal(session.draft, manualIndexes));
    return;
  }

  await i.update(buildBuilderPayload(session.draft, i.channel));
});

registerModalPrefix('modal_rrbuilder_emoji_manual_', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });

  const indexes = i.customId.slice('modal_rrbuilder_emoji_manual_'.length).split('-').map(Number);
  const invalidLabels = [];
  const values = new Map();
  for (const idx of indexes) {
    const value = i.fields.getTextInputValue(`emoji_manual_${idx}`) || '';
    if (!isValidEmojiInput(value)) invalidLabels.push(session.draft.roles[idx]?.label ?? `rol #${idx}`);
    values.set(idx, value);
  }

  if (invalidLabels.length > 0) {
    return i.reply({
      content: `❌ El emoji de ${invalidLabels.join(', ')} no es válido — usá un emoji de Discord (unicode o custom) o dejalo vacío.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  for (const [idx, value] of values) {
    if (session.draft.roles[idx]) session.draft.roles[idx].emoji = value;
  }
  refreshSession(sessionKey(i.guildId, i.user.id), session.draft);

  // Modal encadenado desde OTRO modal (showModal llamado dentro del submit del
  // selector de emoji) — soporte demasiado nuevo de Discord como para confiar en que
  // i.update() siga apuntando al mensaje original del builder después de 2 saltos, algo
  // que no hay forma de probar en este entorno (nunca se levanta el bot local contra
  // producción). Se refresca directo con la interacción dueña de la sesión, cuyo token
  // es independiente y sigue siendo válido.
  await i.deferUpdate().catch(() => {});
  await session.ownerInteraction
    .editReply(buildBuilderPayload(session.draft, session.ownerInteraction.channel))
    .catch((error) => console.error('❌ No se pudo refrescar el builder de rolreacciones después del modal de emoji manual:', error));
});

registerModalPrefix('modal_rrbuilder_json', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });

  const raw = i.fields.getTextInputValue('json');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return i.reply({ content: '❌ Ese texto no es JSON válido — revisá comillas y comas, y probá de nuevo.', flags: MessageFlags.Ephemeral });
  }

  if (!Array.isArray(parsed.roles) || parsed.roles.length === 0) {
    return i.reply({ content: '❌ El JSON necesita un array "roles" con al menos un elemento.', flags: MessageFlags.Ephemeral });
  }
  if (parsed.roles.length > MAX_ROLES_PER_PANEL) {
    return i.reply({ content: `❌ Máximo ${MAX_ROLES_PER_PANEL} roles por panel — el JSON tiene ${parsed.roles.length}.`, flags: MessageFlags.Ephemeral });
  }
  if (parsed.titulo !== undefined && (typeof parsed.titulo !== 'string' || parsed.titulo.length > 256)) {
    return i.reply({ content: '❌ "titulo" tiene que ser texto de hasta 256 caracteres.', flags: MessageFlags.Ephemeral });
  }
  if (parsed.descripcion !== undefined && (typeof parsed.descripcion !== 'string' || parsed.descripcion.length > 1024)) {
    return i.reply({ content: '❌ "descripcion" tiene que ser texto de hasta 1024 caracteres.', flags: MessageFlags.Ephemeral });
  }

  const newRoles = [];
  for (let idx = 0; idx < parsed.roles.length; idx++) {
    const entry = parsed.roles[idx];
    const roleId = entry?.rol;
    if (typeof roleId !== 'string' || !roleId) {
      return i.reply({ content: `❌ El elemento ${idx + 1} de "roles" no tiene un "rol" (ID) válido.`, flags: MessageFlags.Ephemeral });
    }
    const role = i.guild.roles.cache.get(roleId) || (await i.guild.roles.fetch(roleId).catch(() => null));
    if (!role) {
      return i.reply({ content: `❌ No encontré ningún rol con ID \`${roleId}\` en este servidor (elemento ${idx + 1}).`, flags: MessageFlags.Ephemeral });
    }
    const validationError = getRoleValidationError(i.guild, role);
    if (validationError) {
      return i.reply({ content: `❌ ${role} ${validationError} — no se puede usar en un panel de reaction-roles (elemento ${idx + 1}).`, flags: MessageFlags.Ephemeral });
    }
    const emoji = typeof entry.emoji === 'string' ? entry.emoji : '';
    if (emoji && !isValidEmojiInput(emoji)) {
      return i.reply({ content: `❌ El emoji de ${role} no es válido (elemento ${idx + 1}).`, flags: MessageFlags.Ephemeral });
    }
    const etiqueta = typeof entry.etiqueta === 'string' && entry.etiqueta ? entry.etiqueta : role.name;
    newRoles.push({ roleId: role.id, label: etiqueta.slice(0, 80), emoji });
  }

  session.draft.roles = newRoles;
  if (typeof parsed.titulo === 'string') session.draft.title = parsed.titulo;
  if (typeof parsed.descripcion === 'string') session.draft.description = parsed.descripcion;
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

  // Defer ANTES de tocar Discord/Supabase de nuevo (fetch de canal+mensaje, edit, borrado
  // de la fila) — mismo patrón que Fase 2B en los comandos de moderación. Sin esto, la
  // ventana de 3s del token podía vencer con el panel YA borrado (auditoría NEXO V,
  // 2026-09-18): el admin veía "la interacción falló" sobre una acción que sí se aplicó,
  // y el borrado quedaba sin loguear porque el throw cortaba antes de logConfigChange.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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
  await interaction.editReply({ content: '✅ Panel eliminado.' });
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
