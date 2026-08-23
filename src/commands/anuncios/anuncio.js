import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
  UserSelectMenuBuilder,
  AttachmentBuilder,
  MessageFlags,
} from 'discord.js';
import { buildAnuncioEmbed, BRAND_COLOR } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import { registerButtonPrefix } from '../../components/buttons.js';
import { registerSelectPrefix } from '../../components/selects.js';
import { registerModalPrefix } from '../../components/modals.js';
import { saveAnnouncementTemplate, getGuildAnnouncementTemplates, getAnnouncementTemplate } from '../../utils/announcementTemplatesStore.js';

const HEX_REGEX = /^#?[0-9A-Fa-f]{6}$/;
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutos

// Draft del panel en memoria, una entrada por usuario (un solo /anuncio activo a la vez).
// El customId de los componentes no necesita el userId: un mensaje efímero solo puede
// recibir interacciones del usuario que lo generó, Discord ya lo garantiza.
const sessions = new Map();

function refreshSession(userId, draft) {
  const existing = sessions.get(userId);
  if (existing?.timeoutHandle) clearTimeout(existing.timeoutHandle);
  const timeoutHandle = setTimeout(() => sessions.delete(userId), SESSION_TTL_MS);
  sessions.set(userId, { draft, timeoutHandle });
}

function isValidUrl(value) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function normalizeHex(value) {
  return value.startsWith('#') ? value : `#${value}`;
}

// Discohook y el formato de webhooks de Discord exportan el color como entero decimal
// (ej: 8359632), no como string HEX — hay que convertirlo antes de validar/usar.
function colorToHex(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `#${Math.max(0, Math.min(0xffffff, Math.round(value))).toString(16).padStart(6, '0').toUpperCase()}`;
  }
  return value;
}

// Parsea JSON de formato Discord (o discohook-compatible) y lo mergea en el draft.
// Acepta tanto el embed "pelado" ({title, description, ...}) como el payload que copia
// Discohook con "Copy JSON" / el formato de ejecución de webhooks ({content, embeds: [{...}]}) —
// en ese caso se usa el primer embed del array (el panel solo soporta uno).
// Acepta claves en snake_case (Discord API) o camelCase.
// Retorna { success: boolean, error?: string, draft?: object }.
function importJsonToDraft(jsonString, currentDraft) {
  try {
    const parsed = JSON.parse(jsonString);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { success: false, error: 'El JSON debe ser un objeto, no un array.' };
    }

    let obj = parsed;
    if (Array.isArray(parsed.embeds)) {
      if (parsed.embeds.length === 0) {
        return { success: false, error: 'El JSON tiene un array "embeds" vacío — no hay nada que importar.' };
      }
      obj = parsed.embeds[0];
    }

    // String(...) en cada campo de texto: un JSON pegado a mano puede traer un valor
    // no-string en cualquier campo (ej. "title": 123) — sin esto, ese valor pasaba
    // los chequeos de longitud de más abajo ((123).length es undefined) y recién
    // explotaba en EmbedBuilder.setTitle/etc., que solo acepta strings.
    const merged = {
      title: String(obj.title || currentDraft.title || ''),
      description: String(obj.description || currentDraft.description || ''),
      url: String(obj.url || currentDraft.url || ''),
      color: colorToHex(obj.color) || currentDraft.color || BRAND_COLOR,
      authorName: String(obj.author?.name || obj.authorName || currentDraft.authorName || ''),
      authorIconURL: String(obj.author?.icon_url || obj.authorIconURL || currentDraft.authorIconURL || ''),
      authorURL: String(obj.author?.url || obj.authorURL || currentDraft.authorURL || ''),
      thumbnailURL: String(obj.thumbnail?.url || obj.thumbnailURL || currentDraft.thumbnailURL || ''),
      imageURL: String(obj.image?.url || obj.imageURL || currentDraft.imageURL || ''),
      footerText: String(obj.footer?.text || obj.footerText || currentDraft.footerText || ''),
      footerIconURL: String(obj.footer?.icon_url || obj.footerIconURL || currentDraft.footerIconURL || ''),
      timestamp: obj.timestamp !== undefined ? Boolean(obj.timestamp) : currentDraft.timestamp,
      fields: [],
      mention: currentDraft.mention,
    };

    if (obj.fields && Array.isArray(obj.fields)) {
      merged.fields = obj.fields.slice(0, 25).map((f) => ({
        name: String(f.name || ''),
        value: String(f.value || ''),
        inline: Boolean(f.inline ?? false),
      }));
    }

    if (merged.color && !HEX_REGEX.test(merged.color)) {
      return { success: false, error: `Color inválido: "${merged.color}". Usa formato HEX, ej: #7F5AF0.` };
    }

    const urlFields = ['url', 'authorIconURL', 'authorURL', 'thumbnailURL', 'imageURL', 'footerIconURL'];
    for (const field of urlFields) {
      if (merged[field] && !isValidUrl(merged[field])) {
        return { success: false, error: `URL inválida en ${field}: "${merged[field]}"` };
      }
    }

    // Validar longitudes contra los límites reales de un embed de Discord — los
    // modales del panel ya las capean con setMaxLength(), pero un JSON pegado
    // (ej. exportado de Discohook) puede traer texto más largo de lo que Discord
    // permite. Sin este chequeo, el error recién aparece más tarde al armar el
    // embed (buildAnuncioEmbed) con un RangeError genérico que no dice cuál campo
    // era el problema.
    if (merged.title.length > 256) {
      return { success: false, error: `El título tiene ${merged.title.length} caracteres (máximo 256).` };
    }
    if (merged.description.length > 4096) {
      return { success: false, error: `La descripción tiene ${merged.description.length} caracteres (máximo 4096).` };
    }
    if (merged.authorName.length > 256) {
      return { success: false, error: `El nombre del autor tiene ${merged.authorName.length} caracteres (máximo 256).` };
    }
    if (merged.footerText.length > 2048) {
      return { success: false, error: `El texto del footer tiene ${merged.footerText.length} caracteres (máximo 2048).` };
    }
    for (const [index, field] of merged.fields.entries()) {
      if (field.name.length > 256) {
        return { success: false, error: `El campo #${index + 1} tiene un nombre de ${field.name.length} caracteres (máximo 256).` };
      }
      if (field.value.length > 1024) {
        return { success: false, error: `El campo #${index + 1} tiene un valor de ${field.value.length} caracteres (máximo 1024).` };
      }
    }

    return { success: true, draft: merged };
  } catch (e) {
    return { success: false, error: `JSON inválido: ${e.message}` };
  }
}

// ---------- Panel: embed + componentes ----------

// Antes la mención (rol/usuario/@everyone) solo se elegía como opción de /anuncio,
// ANTES de ver el panel — si te olvidabas, había que cancelar y volver a empezar.
function mentionSummary(mention) {
  const parts = [];
  if (mention.everyone) parts.push('@everyone');
  if (mention.rol) parts.push(`@${mention.rol.name}`);
  if (mention.usuario) parts.push(mention.usuario.tag);
  return parts.length > 0 ? `Mención: ${parts.join(', ')}`.slice(0, 80) : 'Mención: ninguna';
}

function buildPanelPayload(draft) {
  const hasContent = Boolean(draft.title || draft.description);
  const embeds = hasContent ? [buildAnuncioEmbed(draft)] : [];

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('anuncio_edit_content').setLabel('Contenido').setEmoji('📝').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('anuncio_edit_color').setLabel('Color').setEmoji('🎨').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('anuncio_edit_author').setLabel('Autor').setEmoji('👤').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('anuncio_edit_images').setLabel('Imágenes').setEmoji('🖼️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('anuncio_edit_footer').setLabel('Footer').setEmoji('📌').setStyle(ButtonStyle.Secondary),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('anuncio_add_field')
      .setLabel(`Campo (${draft.fields.length}/25)`)
      .setEmoji('➕')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(draft.fields.length >= 25),
    new ButtonBuilder()
      .setCustomId('anuncio_toggle_timestamp')
      .setLabel(draft.timestamp ? 'Fecha: activada' : 'Fecha: desactivada')
      .setEmoji('🕒')
      .setStyle(draft.timestamp ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('anuncio_edit_mention').setLabel(mentionSummary(draft.mention)).setEmoji('📣').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('anuncio_send').setLabel('Enviar').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('anuncio_cancel').setLabel('Cancelar').setEmoji('❌').setStyle(ButtonStyle.Danger),
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('anuncio_import_json').setLabel('Importar JSON').setEmoji('📄').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('anuncio_export_json').setLabel('Exportar JSON').setEmoji('💾').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('anuncio_save_template').setLabel('Guardar plantilla').setEmoji('🗂️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('anuncio_load_template').setLabel('Cargar plantilla').setEmoji('📂').setStyle(ButtonStyle.Secondary),
  );

  const components = [row1, row2, row3];

  if (draft.fields.length > 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId('anuncio_remove_field')
      .setPlaceholder('🗑️ Quitar un campo...')
      .addOptions(
        draft.fields.map((f, i) => ({
          label: `${i + 1}. ${f.name || '(sin nombre)'}`.slice(0, 100),
          description: (f.value || '').slice(0, 100) || undefined,
          value: String(i),
        })),
      );
    components.push(new ActionRowBuilder().addComponents(select));
  }

  return {
    content: '**📋 Constructor de anuncio** — usá los botones para completar cada sección. Así se ve en vivo:',
    embeds,
    components,
  };
}

// ---------- Modales por sección ----------

function buildContentModal(draft) {
  const modal = new ModalBuilder().setCustomId('modal_anuncio_content').setTitle('Contenido del anuncio');

  const titulo = new TextInputBuilder()
    .setCustomId('titulo')
    .setLabel('Título')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(256)
    .setRequired(true);
  if (draft.title) titulo.setValue(draft.title);

  const descripcion = new TextInputBuilder()
    .setCustomId('descripcion')
    .setLabel('Descripción')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(4000)
    .setRequired(true);
  if (draft.description) descripcion.setValue(draft.description);

  const url = new TextInputBuilder()
    .setCustomId('url')
    .setLabel('URL del título (opcional)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('https://... (hace que el título sea un enlace)')
    .setRequired(false);
  if (draft.url) url.setValue(draft.url);

  modal.addComponents(
    new ActionRowBuilder().addComponents(titulo),
    new ActionRowBuilder().addComponents(descripcion),
    new ActionRowBuilder().addComponents(url),
  );
  return modal;
}

function buildColorModal(draft) {
  const modal = new ModalBuilder().setCustomId('modal_anuncio_color').setTitle('Color del embed');
  const color = new TextInputBuilder()
    .setCustomId('color')
    .setLabel('Color HEX')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('#7F5AF0')
    .setRequired(true);
  if (draft.color) color.setValue(draft.color);
  modal.addComponents(new ActionRowBuilder().addComponents(color));
  return modal;
}

function buildAuthorModal(draft) {
  const modal = new ModalBuilder().setCustomId('modal_anuncio_author').setTitle('Autor del embed');

  const nombre = new TextInputBuilder()
    .setCustomId('nombre')
    .setLabel('Nombre (vacío = sin autor)')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(256)
    .setRequired(false);
  if (draft.authorName) nombre.setValue(draft.authorName);

  const icono = new TextInputBuilder()
    .setCustomId('icono')
    .setLabel('URL del ícono (opcional)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('https://...')
    .setRequired(false);
  if (draft.authorIconURL) icono.setValue(draft.authorIconURL);

  const enlace = new TextInputBuilder()
    .setCustomId('enlace')
    .setLabel('URL al hacer clic (opcional)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('https://...')
    .setRequired(false);
  if (draft.authorURL) enlace.setValue(draft.authorURL);

  modal.addComponents(
    new ActionRowBuilder().addComponents(nombre),
    new ActionRowBuilder().addComponents(icono),
    new ActionRowBuilder().addComponents(enlace),
  );
  return modal;
}

function buildImagesModal(draft) {
  const modal = new ModalBuilder().setCustomId('modal_anuncio_images').setTitle('Imágenes del embed');

  const thumbnail = new TextInputBuilder()
    .setCustomId('thumbnail')
    .setLabel('Miniatura, esquina superior (opcional)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('https://...')
    .setRequired(false);
  if (draft.thumbnailURL) thumbnail.setValue(draft.thumbnailURL);

  const imagen = new TextInputBuilder()
    .setCustomId('imagen')
    .setLabel('Imagen grande, al pie (opcional)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('https://...')
    .setRequired(false);
  if (draft.imageURL) imagen.setValue(draft.imageURL);

  modal.addComponents(new ActionRowBuilder().addComponents(thumbnail), new ActionRowBuilder().addComponents(imagen));
  return modal;
}

function buildFooterModal(draft) {
  const modal = new ModalBuilder().setCustomId('modal_anuncio_footer').setTitle('Footer del embed');

  const texto = new TextInputBuilder()
    .setCustomId('texto')
    .setLabel('Texto (vacío = sin footer)')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(2048)
    .setRequired(false);
  if (draft.footerText) texto.setValue(draft.footerText);

  const icono = new TextInputBuilder()
    .setCustomId('icono')
    .setLabel('URL del ícono (opcional, necesita texto)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('https://...')
    .setRequired(false);
  if (draft.footerIconURL) icono.setValue(draft.footerIconURL);

  modal.addComponents(new ActionRowBuilder().addComponents(texto), new ActionRowBuilder().addComponents(icono));
  return modal;
}

function buildFieldModal() {
  const modal = new ModalBuilder().setCustomId('modal_anuncio_field').setTitle('Añadir campo');

  const nombre = new TextInputBuilder()
    .setCustomId('nombre')
    .setLabel('Nombre del campo')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(256)
    .setRequired(true);

  const valor = new TextInputBuilder()
    .setCustomId('valor')
    .setLabel('Valor del campo')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1024)
    .setRequired(true);

  const inline = new TextInputBuilder()
    .setCustomId('inline')
    .setLabel('¿En línea? (si/no)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('no')
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(nombre),
    new ActionRowBuilder().addComponents(valor),
    new ActionRowBuilder().addComponents(inline),
  );
  return modal;
}

function buildImportJsonModal() {
  const modal = new ModalBuilder().setCustomId('modal_anuncio_import_json').setTitle('Importar JSON del embed');

  const json = new TextInputBuilder()
    .setCustomId('json')
    .setLabel('Pega el JSON aquí (ej: desde discohook.org)')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('{"title":"...","description":"...","color":"#7F5AF0",...}')
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(json));
  return modal;
}

// ---------- Envío final ----------

// Llamado por el botón "Enviar" del panel. Publica el embed en el canal donde se
// invocó /anuncio y limpia la sesión — a diferencia del resto de los handlers, esta
// interacción termina el flujo en vez de refrescar el panel.
async function sendDraft(interaction, draft) {
  if (!draft.title || !draft.description) {
    await interaction.reply({
      content: '❌ Completá el título y la descripción primero (botón 📝 Contenido).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const mentionParts = [];
  const allowedMentions = { parse: [], roles: [], users: [] };
  const { rol, usuario, everyone } = draft.mention;

  if (everyone) {
    mentionParts.push('@everyone');
    allowedMentions.parse.push('everyone');
  }
  if (rol) {
    mentionParts.push(`<@&${rol.id}>`);
    allowedMentions.roles.push(rol.id);
  }
  if (usuario) {
    mentionParts.push(`<@${usuario.id}>`);
    allowedMentions.users.push(usuario.id);
  }

  try {
    await interaction.channel.send({
      content: mentionParts.length > 0 ? mentionParts.join(' ') : undefined,
      embeds: [buildAnuncioEmbed(draft)],
      allowedMentions,
    });
    sessions.delete(interaction.user.id);
    await interaction.update({ content: '✅ Anuncio enviado correctamente.', embeds: [], components: [] });
  } catch (error) {
    console.error('❌ Error al enviar el anuncio:', error);
    await interaction.reply({ content: '❌ No se pudo enviar el anuncio. Revisá que las URLs de imagen sean válidas.', flags: MessageFlags.Ephemeral });
  }
}

// ---------- Entrada del comando ----------

export async function startBuilder(interaction, { colorPrefill, imagenPrefill, rol, usuario, everyone } = {}) {
  if (!(await isStaff(interaction))) {
    await interaction.reply({ content: '❌ No tenés permisos para usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  const draft = {
    title: '',
    description: '',
    url: '',
    color: colorPrefill || BRAND_COLOR,
    authorName: '',
    authorIconURL: '',
    authorURL: '',
    thumbnailURL: '',
    imageURL: imagenPrefill || '',
    footerText: '',
    footerIconURL: '',
    timestamp: false,
    fields: [],
    mention: { rol: rol || null, usuario: usuario || null, everyone: Boolean(everyone) },
  };

  refreshSession(interaction.user.id, draft);
  await interaction.reply({ ...buildPanelPayload(draft), flags: MessageFlags.Ephemeral });
}

export const data = new SlashCommandBuilder()
  .setName('anuncio')
  .setDescription('Abre el constructor de anuncios con vista previa en vivo.')
  .addStringOption((option) =>
    option
      .setName('color_predefinido')
      .setDescription('Elegí un color de la paleta (opcional, podés poner un HEX propio en el panel)')
      .setRequired(false)
      .addChoices(
        { name: '🟣 Púrpura Nexo (predeterminado)', value: '#7F5AF0' },
        { name: '🔴 Rojo', value: '#E63946' },
        { name: '🟠 Naranja', value: '#F4A261' },
        { name: '🟡 Dorado', value: '#E9C46A' },
        { name: '🟢 Verde', value: '#2A9D8F' },
        { name: '🔵 Azul', value: '#3A86FF' },
        { name: '⚪ Blanco', value: '#FFFFFF' },
        { name: '⚫ Negro', value: '#111111' },
      ),
  )
  .addAttachmentOption((option) =>
    option
      .setName('imagen_archivo')
      .setDescription('Subí una imagen desde tu computadora para el anuncio (opcional)')
      .setRequired(false),
  )
  .addRoleOption((option) =>
    option.setName('mencionar_rol').setDescription('Rol a mencionar junto al anuncio (opcional)').setRequired(false),
  )
  .addUserOption((option) =>
    option
      .setName('mencionar_usuario')
      .setDescription('Usuario a mencionar junto al anuncio (opcional)')
      .setRequired(false),
  )
  .addBooleanOption((option) =>
    option
      .setName('mencionar_everyone')
      .setDescription('Mencionar a @everyone junto al anuncio (opcional)')
      .setRequired(false),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false);

export async function execute(interaction) {
  const rol = interaction.options.getRole('mencionar_rol');
  const usuario = interaction.options.getUser('mencionar_usuario');
  const everyone = interaction.options.getBoolean('mencionar_everyone');
  const colorPredefinido = interaction.options.getString('color_predefinido');
  const imagenArchivo = interaction.options.getAttachment('imagen_archivo');

  await startBuilder(interaction, {
    colorPrefill: colorPredefinido || undefined,
    imagenPrefill: imagenArchivo?.url || undefined,
    rol,
    usuario,
    everyone,
  });
}

// ---------- Registro en los routers de componentes ----------

function requireSession(interaction) {
  const session = sessions.get(interaction.user.id);
  return session || null;
}

const SESSION_EXPIRED = '❌ Esta sesión expiró. Iniciá de nuevo con `/anuncio`.';

registerButtonPrefix('anuncio_edit_content', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
  await i.showModal(buildContentModal(session.draft));
});

registerButtonPrefix('anuncio_edit_color', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
  await i.showModal(buildColorModal(session.draft));
});

registerButtonPrefix('anuncio_edit_author', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
  await i.showModal(buildAuthorModal(session.draft));
});

registerButtonPrefix('anuncio_edit_images', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
  await i.showModal(buildImagesModal(session.draft));
});

registerButtonPrefix('anuncio_edit_footer', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
  await i.showModal(buildFooterModal(session.draft));
});

registerButtonPrefix('anuncio_add_field', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
  if (session.draft.fields.length >= 25) return i.reply({ content: '❌ Máximo 25 campos por embed.', flags: MessageFlags.Ephemeral });
  await i.showModal(buildFieldModal());
});

registerButtonPrefix('anuncio_toggle_timestamp', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
  session.draft.timestamp = !session.draft.timestamp;
  refreshSession(i.user.id, session.draft);
  await i.update(buildPanelPayload(session.draft));
});

registerButtonPrefix('anuncio_send', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
  await sendDraft(i, session.draft);
});

registerButtonPrefix('anuncio_cancel', async (i) => {
  sessions.delete(i.user.id);
  await i.update({ content: '❌ Anuncio cancelado.', embeds: [], components: [] });
});

registerButtonPrefix('anuncio_import_json', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
  await i.showModal(buildImportJsonModal());
});

registerSelectPrefix('anuncio_remove_field', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
  const index = parseInt(i.values[0], 10);
  session.draft.fields.splice(index, 1);
  refreshSession(i.user.id, session.draft);
  await i.update(buildPanelPayload(session.draft));
});

registerModalPrefix('modal_anuncio_content', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });

  const url = i.fields.getTextInputValue('url') || '';
  if (url && !isValidUrl(url)) {
    return i.reply({ content: '❌ La URL del título no es válida.', flags: MessageFlags.Ephemeral });
  }

  session.draft.title = i.fields.getTextInputValue('titulo');
  session.draft.description = i.fields.getTextInputValue('descripcion');
  session.draft.url = url;
  refreshSession(i.user.id, session.draft);
  await i.update(buildPanelPayload(session.draft));
});

registerModalPrefix('modal_anuncio_color', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });

  const colorInput = i.fields.getTextInputValue('color');
  if (!HEX_REGEX.test(colorInput)) {
    return i.reply({ content: '❌ El color no es válido. Usa formato HEX, ejemplo: `#7F5AF0`.', flags: MessageFlags.Ephemeral });
  }

  session.draft.color = normalizeHex(colorInput);
  refreshSession(i.user.id, session.draft);
  await i.update(buildPanelPayload(session.draft));
});

registerModalPrefix('modal_anuncio_author', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });

  const icono = i.fields.getTextInputValue('icono') || '';
  const enlace = i.fields.getTextInputValue('enlace') || '';
  if (icono && !isValidUrl(icono)) return i.reply({ content: '❌ La URL del ícono no es válida.', flags: MessageFlags.Ephemeral });
  if (enlace && !isValidUrl(enlace)) return i.reply({ content: '❌ La URL de enlace no es válida.', flags: MessageFlags.Ephemeral });

  session.draft.authorName = i.fields.getTextInputValue('nombre');
  session.draft.authorIconURL = icono;
  session.draft.authorURL = enlace;
  refreshSession(i.user.id, session.draft);
  await i.update(buildPanelPayload(session.draft));
});

registerModalPrefix('modal_anuncio_images', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });

  const thumbnail = i.fields.getTextInputValue('thumbnail') || '';
  const imagen = i.fields.getTextInputValue('imagen') || '';
  if (thumbnail && !isValidUrl(thumbnail)) return i.reply({ content: '❌ La URL de la miniatura no es válida.', flags: MessageFlags.Ephemeral });
  if (imagen && !isValidUrl(imagen)) return i.reply({ content: '❌ La URL de la imagen no es válida.', flags: MessageFlags.Ephemeral });

  session.draft.thumbnailURL = thumbnail;
  session.draft.imageURL = imagen;
  refreshSession(i.user.id, session.draft);
  await i.update(buildPanelPayload(session.draft));
});

registerModalPrefix('modal_anuncio_footer', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });

  const icono = i.fields.getTextInputValue('icono') || '';
  if (icono && !isValidUrl(icono)) return i.reply({ content: '❌ La URL del ícono no es válida.', flags: MessageFlags.Ephemeral });

  session.draft.footerText = i.fields.getTextInputValue('texto');
  session.draft.footerIconURL = icono;
  refreshSession(i.user.id, session.draft);
  await i.update(buildPanelPayload(session.draft));
});

registerModalPrefix('modal_anuncio_field', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
  if (session.draft.fields.length >= 25) {
    return i.reply({ content: '❌ Máximo 25 campos por embed.', flags: MessageFlags.Ephemeral });
  }

  const inlineRaw = (i.fields.getTextInputValue('inline') || '').trim().toLowerCase();
  session.draft.fields.push({
    name: i.fields.getTextInputValue('nombre'),
    value: i.fields.getTextInputValue('valor'),
    inline: inlineRaw.startsWith('s') || inlineRaw === 'yes' || inlineRaw === 'true',
  });
  refreshSession(i.user.id, session.draft);
  await i.update(buildPanelPayload(session.draft));
});

registerModalPrefix('modal_anuncio_import_json', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });

  const jsonString = i.fields.getTextInputValue('json');
  const result = importJsonToDraft(jsonString, session.draft);

  if (!result.success) {
    return i.reply({ content: `❌ ${result.error}`, flags: MessageFlags.Ephemeral });
  }

  refreshSession(i.user.id, result.draft);
  await i.update(buildPanelPayload(result.draft));
});

// ---------- Mención (editable dentro del panel, no solo al invocar /anuncio) ----------

function buildMentionEditorPayload(draft) {
  const roleSelect = new RoleSelectMenuBuilder().setCustomId('anuncio_mention_role_select').setPlaceholder('Rol a mencionar (opcional)').setMinValues(0).setMaxValues(1);
  const userSelect = new UserSelectMenuBuilder().setCustomId('anuncio_mention_user_select').setPlaceholder('Usuario a mencionar (opcional)').setMinValues(0).setMaxValues(1);
  const everyoneButton = new ButtonBuilder()
    .setCustomId('anuncio_mention_everyone_toggle')
    .setLabel(draft.mention.everyone ? '@everyone: activado' : '@everyone: desactivado')
    .setStyle(draft.mention.everyone ? ButtonStyle.Success : ButtonStyle.Secondary);
  const doneButton = new ButtonBuilder().setCustomId('anuncio_mention_done').setLabel('Listo').setStyle(ButtonStyle.Primary);

  return {
    content: `📣 **Mención del anuncio** — ${mentionSummary(draft.mention)}`,
    embeds: [],
    components: [
      new ActionRowBuilder().addComponents(roleSelect),
      new ActionRowBuilder().addComponents(userSelect),
      new ActionRowBuilder().addComponents(everyoneButton, doneButton),
    ],
  };
}

registerButtonPrefix('anuncio_edit_mention', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
  // Mensaje efímero aparte (no un modal — los modales no admiten selects) para no perder
  // el panel principal; la mención se aplica igual al enviar, esté abierto o no.
  await i.reply({ ...buildMentionEditorPayload(session.draft), flags: MessageFlags.Ephemeral });
});

registerSelectPrefix('anuncio_mention_role_select', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
  session.draft.mention.rol = i.roles.first() || null;
  refreshSession(i.user.id, session.draft);
  await i.update(buildMentionEditorPayload(session.draft));
});

registerSelectPrefix('anuncio_mention_user_select', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
  session.draft.mention.usuario = i.users.first() || null;
  refreshSession(i.user.id, session.draft);
  await i.update(buildMentionEditorPayload(session.draft));
});

registerButtonPrefix('anuncio_mention_everyone_toggle', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
  session.draft.mention.everyone = !session.draft.mention.everyone;
  refreshSession(i.user.id, session.draft);
  await i.update(buildMentionEditorPayload(session.draft));
});

registerButtonPrefix('anuncio_mention_done', async (i) => {
  await i.update({ content: '✅ Mención actualizada — ya queda aplicada cuando envíes el anuncio desde el panel principal.', components: [] });
});

// ---------- Exportar JSON ----------

registerButtonPrefix('anuncio_export_json', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
  if (!session.draft.title && !session.draft.description) {
    return i.reply({ content: '❌ No hay contenido para exportar todavía (botón 📝 Contenido).', flags: MessageFlags.Ephemeral });
  }

  const json = JSON.stringify(buildAnuncioEmbed(session.draft).toJSON(), null, 2);
  const attachment = new AttachmentBuilder(Buffer.from(json, 'utf-8'), { name: 'anuncio.json' });
  await i.reply({ content: '💾 JSON del anuncio actual — compatible con el botón 📄 Importar JSON (acá o en otro servidor).', files: [attachment], flags: MessageFlags.Ephemeral });
});

// ---------- Plantillas guardadas ----------

function buildSaveTemplateModal() {
  const modal = new ModalBuilder().setCustomId('modal_anuncio_save_template').setTitle('Guardar plantilla');
  const nombre = new TextInputBuilder().setCustomId('nombre').setLabel('Nombre de la plantilla').setStyle(TextInputStyle.Short).setMaxLength(60).setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(nombre));
  return modal;
}

registerButtonPrefix('anuncio_save_template', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
  if (!session.draft.title || !session.draft.description) {
    return i.reply({ content: '❌ Completá al menos título y descripción antes de guardar una plantilla.', flags: MessageFlags.Ephemeral });
  }
  await i.showModal(buildSaveTemplateModal());
});

registerModalPrefix('modal_anuncio_save_template', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });

  const nombre = i.fields.getTextInputValue('nombre').trim();
  if (!nombre) return i.reply({ content: '❌ El nombre no puede estar vacío.', flags: MessageFlags.Ephemeral });

  // La mención NO se guarda en la plantilla a propósito: es específica de un envío
  // puntual (a quién avisarle esta vez), no parte del formato reutilizable.
  const { mention, ...templateData } = session.draft;
  const saved = await saveAnnouncementTemplate(i.guildId, nombre, templateData, i.user.id);
  await i.reply({
    content: saved ? `✅ Plantilla **${nombre}** guardada.` : `❌ Ya existe una plantilla llamada **${nombre}** en este servidor. Elegí otro nombre.`,
    flags: MessageFlags.Ephemeral,
  });
});

registerButtonPrefix('anuncio_load_template', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });

  const templates = await getGuildAnnouncementTemplates(i.guildId);
  if (templates.length === 0) {
    return i.reply({ content: 'ℹ️ Todavía no hay plantillas guardadas en este servidor. Guardá una con el botón 🗂️ Guardar plantilla.', flags: MessageFlags.Ephemeral });
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId('anuncio_template_select')
    .setPlaceholder('Elegí una plantilla para cargar')
    .addOptions(templates.slice(0, 25).map((t) => ({ label: t.name.slice(0, 100), value: t.name })));

  await i.reply({
    content: '📂 Elegí qué plantilla cargar (reemplaza el contenido actual del panel, no toca la mención):',
    components: [new ActionRowBuilder().addComponents(select)],
    flags: MessageFlags.Ephemeral,
  });
});

registerSelectPrefix('anuncio_template_select', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });

  const templateData = await getAnnouncementTemplate(i.guildId, i.values[0]);
  if (!templateData) {
    return i.update({ content: '❌ Esa plantilla ya no existe (la borraron o nunca se guardó).', components: [] });
  }

  session.draft = { ...session.draft, ...templateData };
  refreshSession(i.user.id, session.draft);

  await i.update({ content: `✅ Plantilla **${i.values[0]}** cargada.`, components: [] });
  // El panel original es OTRO mensaje (este select vive en uno propio) — no se puede
  // refrescar a distancia, así que se manda uno nuevo ya actualizado para seguir editando.
  await i.followUp({ ...buildPanelPayload(session.draft), flags: MessageFlags.Ephemeral });
});
