import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import { getGuildShopItems, getShopItem, addShopItem, updateShopItem, removeShopItem, hasCustomShopItems } from '../../utils/shopStore.js';
import { isAdmin } from '../../utils/permissions.js';
import { MAX_MYSTERY } from './buy.js';
import { EMERALD_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { registerButtonPrefix } from '../../components/buttons.js';
import { registerSelectPrefix } from '../../components/selects.js';
import { registerModalPrefix } from '../../components/modals.js';

const ADMIN_ONLY_MESSAGE =
  '❌ Este comando requiere el rol de Administrador configurado con `/config rol-admin` — no es un permiso nativo de Discord, un Moderador no puede usarlo.';

async function handleAgregar(interaction) {
  const name = interaction.options.getString('nombre');
  const price = interaction.options.getInteger('precio');
  const description = interaction.options.getString('descripcion') || 'Sin descripción.';
  const category = interaction.options.getString('categoria') || 'General';
  const role = interaction.options.getRole('rol');
  const manual = interaction.options.getBoolean('entrega_manual') ?? false;
  const tipo = interaction.options.getString('tipo') || null;

  // Defensa en profundidad (auditoría 2026-09-12, hallazgo de economía #1): con
  // isAdmin() ya exigido para todo el comando, esto ya no es explotable por un
  // moderador — pero un admin real tipeando el precio a mano (250 en vez de 400+)
  // seguiría creando una caja positiva en expectativa por error, no por malicia.
  if (tipo === 'mystery_box' && price < MAX_MYSTERY) {
    await interaction.reply({
      content: `❌ Una caja misteriosa paga entre 50 y ${MAX_MYSTERY} monedas al azar — con un precio menor a ${MAX_MYSTERY} sería casi siempre ganancia neta para quien la compre. Usá un precio de ${MAX_MYSTERY} o más.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const wasUsingDefaults = !(await hasCustomShopItems(interaction.guildId));

  const itemId = await addShopItem(interaction.guildId, {
    name,
    description,
    category,
    price,
    roleId: role?.id || null,
    fulfillment: manual ? 'manual' : null,
    type: tipo,
  });

  if (!itemId) {
    await interaction.editReply({ content: '❌ Ya existe un ítem con un nombre muy parecido en tu tienda. Probá con otro nombre.' });
    return;
  }

  let content = `✅ Se agregó **${name}** (${price.toLocaleString('es-ES')} monedas) a la tienda.`;
  if (wasUsingDefaults) {
    content += '\nℹ️ Tu servidor estaba usando el catálogo de ejemplo — a partir de ahora `/shop` muestra solo tus propios ítems.';
  }

  await interaction.editReply({ content });
}

async function handleQuitar(interaction) {
  const itemId = interaction.options.getString('item');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const removed = await removeShopItem(interaction.guildId, itemId);
  await interaction.editReply({
    content: removed ? '✅ Ítem eliminado de la tienda.' : '❌ No se encontró ese ítem en tu tienda (¿ya lo habías borrado?).',
  });
}

const LISTAR_PAGE_SIZE = 10;

// Cada ítem es su propio campo (mismo criterio que /warns y /economia-staff historial)
// en vez de una sola descripción con saltos de línea — más fácil de escanear con un
// catálogo grande, y paginado porque un embed no aguanta más de 25 campos.
function buildListarEmbed(items, page) {
  const totalPages = Math.max(1, Math.ceil(items.length / LISTAR_PAGE_SIZE));
  const clampedPage = Math.min(Math.max(0, page), totalPages - 1);
  const slice = items.slice(clampedPage * LISTAR_PAGE_SIZE, clampedPage * LISTAR_PAGE_SIZE + LISTAR_PAGE_SIZE);

  const embed = new EmbedBuilder()
    .setColor(EMERALD_COLOR)
    .setTitle('📦 Catálogo de la tienda')
    .setFooter({ text: `${BRAND_NAME} • Página ${clampedPage + 1}/${totalPages} • Usá el id (\`...\`) en /shop-admin quitar/editar` })
    .setTimestamp();

  if (items.length === 0) {
    embed.setDescription('No hay ítems configurados.');
  } else {
    embed.addFields(
      slice.map((i) => ({
        name: i.name,
        value: `${i.price.toLocaleString('es-ES')} monedas · \`${i.id}\`${i.roleId ? ` · rol <@&${i.roleId}>` : ''}${i.fulfillment === 'manual' ? ' · entrega manual' : ''}${i.type === 'xp_boost' ? ' · ⚡ impulso de XP' : ''}${i.type === 'mystery_box' ? ' · 🎁 caja misteriosa' : ''}${i.type === 'rob_shield' ? ' · 🛡️ escudo anti-robo' : ''}`,
      })),
    );
  }

  return { embed, clampedPage, totalPages };
}

function buildListarRow(clampedPage, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`shopadmin_listar_page_${clampedPage - 1}`)
      .setLabel('◀️ Anterior')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clampedPage <= 0),
    new ButtonBuilder()
      .setCustomId(`shopadmin_listar_page_${clampedPage + 1}`)
      .setLabel('Siguiente ▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clampedPage >= totalPages - 1),
  );
}

// Auditoría UX/UI (2026-09-18), hallazgo Mejora "/shop-admin agregar/editar se
// beneficiaría de un modal con preview, mismo patrón que /anuncio" — acá siempre
// visibles (no solo con >1 página), es el punto de entrada al builder.
function buildBuilderEntryRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('shopadmin_builder_new').setLabel('Agregar (con vista previa)').setEmoji('🎨').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('shopadmin_builder_edit').setLabel('Editar (con vista previa)').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
  );
}

function buildListarComponents(clampedPage, totalPages) {
  const rows = [];
  if (totalPages > 1) rows.push(buildListarRow(clampedPage, totalPages));
  rows.push(buildBuilderEntryRow());
  return rows;
}

async function handleListar(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const items = await getGuildShopItems(interaction.guildId);
  const { embed, clampedPage, totalPages } = buildListarEmbed(items, 0);
  await interaction.editReply({ embeds: [embed], components: buildListarComponents(clampedPage, totalPages) });
}

registerButtonPrefix('shopadmin_listar_page_', async (i) => {
  if (!(await isAdmin(i))) return i.reply({ content: ADMIN_ONLY_MESSAGE, flags: MessageFlags.Ephemeral });
  const page = parseInt(i.customId.slice('shopadmin_listar_page_'.length), 10);
  const items = await getGuildShopItems(i.guildId);
  const { embed, clampedPage, totalPages } = buildListarEmbed(items, page);
  await i.update({ embeds: [embed], components: buildListarComponents(clampedPage, totalPages) });
});

// A diferencia de borrar + volver a agregar (que le cambia el item_id y rompe la
// referencia de quien ya lo tiene en /inventory), esto corrige los datos del mismo ítem.
// Todas las opciones son opcionales — solo se pisa lo que el staff completó.
async function handleEditar(interaction) {
  const itemId = interaction.options.getString('item');
  const nombre = interaction.options.getString('nombre');
  const precio = interaction.options.getInteger('precio');
  const descripcion = interaction.options.getString('descripcion');
  const categoria = interaction.options.getString('categoria');
  const rol = interaction.options.getRole('rol');

  if (!nombre && precio == null && !descripcion && !categoria && !rol) {
    await interaction.reply({ content: '❌ Completá al menos un campo para editar.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Mismo piso que handleAgregar — editar() no puede cambiar el `type` de un ítem
  // (updateShopItem no lo acepta), pero SÍ puede bajarle el precio a uno que ya es
  // mystery_box, reabriendo el mismo hueco por otra puerta.
  if (precio != null) {
    const existing = await getShopItem(interaction.guildId, itemId);
    if (existing?.type === 'mystery_box' && precio < MAX_MYSTERY) {
      await interaction.reply({
        content: `❌ Ese ítem es una caja misteriosa (paga hasta ${MAX_MYSTERY} monedas al azar) — un precio menor a ${MAX_MYSTERY} la vuelve ganancia neta para quien la compre.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const patch = {};
  if (nombre) patch.name = nombre;
  if (precio != null) patch.price = precio;
  if (descripcion) patch.description = descripcion;
  if (categoria) patch.category = categoria;
  if (rol) patch.roleId = rol.id;

  const updated = await updateShopItem(interaction.guildId, itemId, patch);
  await interaction.editReply({
    content: updated ? '✅ Ítem actualizado. Su id interno no cambió, así que el inventario de quien ya lo compró sigue funcionando.' : '❌ No se encontró ese ítem en tu tienda.',
  });
}

// ---------- Builder con vista previa (hallazgo Mejora: "/shop-admin agregar/editar
// (7 opciones) se beneficiaría de un modal con preview, mismo patrón que /anuncio") ----------
// Alcance deliberadamente más chico que /anuncio (922 líneas) o /rolreacciones — un
// ítem de tienda son 7 campos simples, sin imagen/attachment, no justifica esa
// complejidad. Sesión en memoria (mismo patrón TTL que el resto del proyecto), sin
// invalidar un builder viejo al abrir uno nuevo (a diferencia de /rolreacciones) — un
// admin agregando/editando ítems no suele tener dos builders a la vez, y el TTL de 10
// min ya cubre el caso de dejarlo abierto sin usar.
const BUILDER_TTL_MS = 10 * 60 * 1000;
const builderSessions = new Map(); // `${guildId}:${userId}` -> { draft, mode, itemId, timeoutHandle }

function builderKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function refreshBuilderSession(key, draft, mode, itemId) {
  const existing = builderSessions.get(key);
  if (existing) clearTimeout(existing.timeoutHandle);
  const timeoutHandle = setTimeout(() => builderSessions.delete(key), BUILDER_TTL_MS).unref();
  builderSessions.set(key, { draft, mode, itemId, timeoutHandle });
}

const TIPO_OPTIONS = [
  { label: 'Ítem normal', value: 'none', description: 'Se guarda en el inventario, sin efecto especial' },
  { label: 'Impulso de XP (x2 por 24hs)', value: 'xp_boost' },
  { label: 'Caja misteriosa (monedas al azar)', value: 'mystery_box' },
  { label: 'Escudo anti-robo (protege de /rob por 2hs)', value: 'rob_shield' },
];

// Misma línea de detalle que ya arma buildListarEmbed para un ítem real — la vista
// previa del builder tiene que verse EXACTAMENTE como se va a ver una vez guardado,
// nunca un resumen aparte que puede divergir.
function buildItemDetailLine(draft) {
  const price = draft.price != null ? `${draft.price.toLocaleString('es-ES')} monedas` : '*(sin precio)*';
  const extras = [];
  if (draft.roleId) extras.push(`rol <@&${draft.roleId}>`);
  if (draft.manual) extras.push('entrega manual');
  if (draft.tipo === 'xp_boost') extras.push('⚡ impulso de XP');
  if (draft.tipo === 'mystery_box') extras.push('🎁 caja misteriosa');
  if (draft.tipo === 'rob_shield') extras.push('🛡️ escudo anti-robo');
  return `${price}${extras.length ? ` · ${extras.join(' · ')}` : ''}`;
}

function buildBuilderPayload(draft, mode) {
  const isEdit = mode === 'edit';
  const embed = new EmbedBuilder()
    .setColor(EMERALD_COLOR)
    .setTitle(isEdit ? '✏️ Editar ítem — vista previa' : '🎨 Nuevo ítem — vista previa')
    .setDescription('Así se va a ver en `/shop` y `/shop-admin listar`. Completá los campos con los controles de abajo y guardá cuando esté listo.')
    .addFields(
      { name: draft.name || '*(sin nombre — obligatorio)*', value: `${buildItemDetailLine(draft)}\n${draft.description || '*(sin descripción)*'}` },
      { name: 'Categoría', value: draft.category || 'General (por defecto)', inline: true },
    )
    .setFooter({ text: BRAND_NAME });
  if (isEdit) {
    embed.addFields({
      name: '🔒 No editable acá',
      value: 'El comportamiento especial y la entrega manual no se pueden cambiar después de creado — quedan como estaban.',
    });
  }

  const fieldsRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('shopadmin_builder_fields').setLabel('Nombre / Precio / Descripción / Categoría').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
  );
  const roleRow = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder().setCustomId('shopadmin_builder_role').setPlaceholder('Rol a asignar al comprarlo (opcional)').setMinValues(0).setMaxValues(1),
  );
  const tipoRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('shopadmin_builder_tipo')
      .setPlaceholder(isEdit ? 'No se puede cambiar después de creado' : 'Comportamiento especial (opcional)')
      .setDisabled(isEdit)
      .addOptions(TIPO_OPTIONS.map((o) => ({ ...o, default: (draft.tipo || 'none') === o.value }))),
  );
  const actionsRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('shopadmin_builder_manual')
      .setLabel(`Entrega manual: ${draft.manual ? 'Sí' : 'No'}`)
      .setEmoji('📩')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(isEdit),
    new ButtonBuilder().setCustomId('shopadmin_builder_save').setLabel('Guardar').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('shopadmin_builder_cancel').setLabel('Cancelar').setEmoji('❌').setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [fieldsRow, roleRow, tipoRow, actionsRow] };
}

function buildFieldsModal(draft) {
  const modal = new ModalBuilder().setCustomId('modal_shopadmin_builder_fields').setTitle('Datos del ítem');
  const nombre = new TextInputBuilder().setCustomId('nombre').setLabel('Nombre').setStyle(TextInputStyle.Short).setMaxLength(80).setRequired(true);
  if (draft.name) nombre.setValue(draft.name);
  const precio = new TextInputBuilder().setCustomId('precio').setLabel('Precio (monedas)').setStyle(TextInputStyle.Short).setRequired(true);
  if (draft.price != null) precio.setValue(String(draft.price));
  const descripcion = new TextInputBuilder().setCustomId('descripcion').setLabel('Descripción (opcional)').setStyle(TextInputStyle.Paragraph).setMaxLength(200).setRequired(false);
  if (draft.description) descripcion.setValue(draft.description);
  const categoria = new TextInputBuilder().setCustomId('categoria').setLabel('Categoría (opcional, default: General)').setStyle(TextInputStyle.Short).setMaxLength(40).setRequired(false);
  if (draft.category) categoria.setValue(draft.category);

  modal.addComponents(
    new ActionRowBuilder().addComponents(nombre),
    new ActionRowBuilder().addComponents(precio),
    new ActionRowBuilder().addComponents(descripcion),
    new ActionRowBuilder().addComponents(categoria),
  );
  return modal;
}

function emptyDraft() {
  return { name: null, price: null, description: null, category: null, roleId: null, manual: false, tipo: 'none' };
}

registerButtonPrefix('shopadmin_builder_new', async (i) => {
  if (!(await isAdmin(i))) return i.reply({ content: ADMIN_ONLY_MESSAGE, flags: MessageFlags.Ephemeral });
  const draft = emptyDraft();
  refreshBuilderSession(builderKey(i.guildId, i.user.id), draft, 'create', null);
  await i.reply({ ...buildBuilderPayload(draft, 'create'), flags: MessageFlags.Ephemeral });
});

registerButtonPrefix('shopadmin_builder_edit', async (i) => {
  if (!(await isAdmin(i))) return i.reply({ content: ADMIN_ONLY_MESSAGE, flags: MessageFlags.Ephemeral });
  const items = await getGuildShopItems(i.guildId);
  if (items.length === 0) {
    return i.reply({ content: 'ℹ️ Todavía no hay ítems en la tienda de este servidor para editar.', flags: MessageFlags.Ephemeral });
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId('shopadmin_builder_edit_select')
    .setPlaceholder('Elegí qué ítem editar...')
    .addOptions(
      items.slice(0, 25).map((item) => ({
        label: item.name.slice(0, 100),
        description: `${item.price.toLocaleString('es-ES')} monedas`.slice(0, 100),
        value: item.id,
      })),
    );
  await i.reply({ content: 'Elegí el ítem que querés editar:', components: [new ActionRowBuilder().addComponents(select)], flags: MessageFlags.Ephemeral });
});

registerSelectPrefix('shopadmin_builder_edit_select', async (i) => {
  if (!(await isAdmin(i))) return i.reply({ content: ADMIN_ONLY_MESSAGE, flags: MessageFlags.Ephemeral });
  const itemId = i.values[0];
  const item = await getShopItem(i.guildId, itemId);
  if (!item) return i.update({ content: '❌ Ese ítem ya no existe en tu tienda (¿se borró mientras elegías?).', components: [] });

  const draft = {
    name: item.name,
    price: item.price,
    description: item.description,
    category: item.category,
    roleId: item.roleId,
    manual: item.fulfillment === 'manual',
    tipo: item.type || 'none',
  };
  refreshBuilderSession(builderKey(i.guildId, i.user.id), draft, 'edit', itemId);
  await i.update(buildBuilderPayload(draft, 'edit'));
});

function requireBuilderSession(i) {
  return builderSessions.get(builderKey(i.guildId, i.user.id));
}
const BUILDER_EXPIRED_MESSAGE = '⏳ Esta sesión expiró (10 min) o ya se guardó — abrí el builder de nuevo desde `/shop-admin listar`.';

registerButtonPrefix('shopadmin_builder_fields', async (i) => {
  if (!(await isAdmin(i))) return i.reply({ content: ADMIN_ONLY_MESSAGE, flags: MessageFlags.Ephemeral });
  const session = requireBuilderSession(i);
  if (!session) return i.reply({ content: BUILDER_EXPIRED_MESSAGE, flags: MessageFlags.Ephemeral });
  await i.showModal(buildFieldsModal(session.draft));
});

registerModalPrefix('modal_shopadmin_builder_fields', async (i) => {
  if (!(await isAdmin(i))) return i.reply({ content: ADMIN_ONLY_MESSAGE, flags: MessageFlags.Ephemeral });
  const key = builderKey(i.guildId, i.user.id);
  const session = builderSessions.get(key);
  if (!session) return i.reply({ content: BUILDER_EXPIRED_MESSAGE, flags: MessageFlags.Ephemeral });

  const precioRaw = i.fields.getTextInputValue('precio').trim();
  const precio = Number.parseInt(precioRaw, 10);
  if (!Number.isInteger(precio) || String(precio) !== precioRaw || precio < 1) {
    return i.reply({ content: '❌ El precio tiene que ser un número entero de 1 o más.', flags: MessageFlags.Ephemeral });
  }

  session.draft.name = i.fields.getTextInputValue('nombre').trim();
  session.draft.price = precio;
  session.draft.description = i.fields.getTextInputValue('descripcion').trim() || null;
  session.draft.category = i.fields.getTextInputValue('categoria').trim() || null;
  refreshBuilderSession(key, session.draft, session.mode, session.itemId);
  await i.update(buildBuilderPayload(session.draft, session.mode));
});

registerSelectPrefix('shopadmin_builder_role', async (i) => {
  if (!(await isAdmin(i))) return i.reply({ content: ADMIN_ONLY_MESSAGE, flags: MessageFlags.Ephemeral });
  const key = builderKey(i.guildId, i.user.id);
  const session = builderSessions.get(key);
  if (!session) return i.reply({ content: BUILDER_EXPIRED_MESSAGE, flags: MessageFlags.Ephemeral });

  session.draft.roleId = i.values[0] || null;
  refreshBuilderSession(key, session.draft, session.mode, session.itemId);
  await i.update(buildBuilderPayload(session.draft, session.mode));
});

registerSelectPrefix('shopadmin_builder_tipo', async (i) => {
  if (!(await isAdmin(i))) return i.reply({ content: ADMIN_ONLY_MESSAGE, flags: MessageFlags.Ephemeral });
  const key = builderKey(i.guildId, i.user.id);
  const session = builderSessions.get(key);
  if (!session) return i.reply({ content: BUILDER_EXPIRED_MESSAGE, flags: MessageFlags.Ephemeral });

  session.draft.tipo = i.values[0];
  refreshBuilderSession(key, session.draft, session.mode, session.itemId);
  await i.update(buildBuilderPayload(session.draft, session.mode));
});

registerButtonPrefix('shopadmin_builder_manual', async (i) => {
  if (!(await isAdmin(i))) return i.reply({ content: ADMIN_ONLY_MESSAGE, flags: MessageFlags.Ephemeral });
  const key = builderKey(i.guildId, i.user.id);
  const session = builderSessions.get(key);
  if (!session) return i.reply({ content: BUILDER_EXPIRED_MESSAGE, flags: MessageFlags.Ephemeral });

  session.draft.manual = !session.draft.manual;
  refreshBuilderSession(key, session.draft, session.mode, session.itemId);
  await i.update(buildBuilderPayload(session.draft, session.mode));
});

registerButtonPrefix('shopadmin_builder_cancel', async (i) => {
  if (!(await isAdmin(i))) return i.reply({ content: ADMIN_ONLY_MESSAGE, flags: MessageFlags.Ephemeral });
  const key = builderKey(i.guildId, i.user.id);
  const session = builderSessions.get(key);
  if (session) {
    clearTimeout(session.timeoutHandle);
    builderSessions.delete(key);
  }
  await i.update({ content: '❌ Cancelado — no se guardó nada.', embeds: [], components: [] });
});

registerButtonPrefix('shopadmin_builder_save', async (i) => {
  if (!(await isAdmin(i))) return i.reply({ content: ADMIN_ONLY_MESSAGE, flags: MessageFlags.Ephemeral });
  const key = builderKey(i.guildId, i.user.id);
  const session = builderSessions.get(key);
  if (!session) return i.reply({ content: BUILDER_EXPIRED_MESSAGE, flags: MessageFlags.Ephemeral });

  const { draft, mode, itemId } = session;
  if (!draft.name || draft.price == null) {
    return i.reply({ content: '❌ Completá al menos Nombre y Precio antes de guardar.', flags: MessageFlags.Ephemeral });
  }

  // Mismo piso que handleAgregar/handleEditar — defensa en profundidad, no el cierre de
  // un bypass real (isAdmin() ya lo exige arriba en las 3 superficies).
  const tipo = draft.tipo === 'none' ? null : draft.tipo;
  if (mode === 'create' && tipo === 'mystery_box' && draft.price < MAX_MYSTERY) {
    return i.reply({
      content: `❌ Una caja misteriosa paga entre 50 y ${MAX_MYSTERY} monedas al azar — con un precio menor a ${MAX_MYSTERY} sería casi siempre ganancia neta para quien la compre. Usá un precio de ${MAX_MYSTERY} o más.`,
      flags: MessageFlags.Ephemeral,
    });
  }
  if (mode === 'edit' && draft.tipo === 'mystery_box' && draft.price < MAX_MYSTERY) {
    return i.reply({
      content: `❌ Ese ítem es una caja misteriosa (paga hasta ${MAX_MYSTERY} monedas al azar) — un precio menor a ${MAX_MYSTERY} la vuelve ganancia neta para quien la compre.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await i.deferUpdate();
  clearTimeout(session.timeoutHandle);
  builderSessions.delete(key);

  if (mode === 'create') {
    const wasUsingDefaults = !(await hasCustomShopItems(i.guildId));
    const newItemId = await addShopItem(i.guildId, {
      name: draft.name,
      description: draft.description || 'Sin descripción.',
      category: draft.category || 'General',
      price: draft.price,
      roleId: draft.roleId || null,
      fulfillment: draft.manual ? 'manual' : null,
      type: tipo,
    });
    if (!newItemId) {
      await i.editReply({ content: '❌ Ya existe un ítem con un nombre muy parecido en tu tienda. Probá con otro nombre.', embeds: [], components: [] });
      return;
    }
    let content = `✅ Se agregó **${draft.name}** (${draft.price.toLocaleString('es-ES')} monedas) a la tienda.`;
    if (wasUsingDefaults) {
      content += '\nℹ️ Tu servidor estaba usando el catálogo de ejemplo — a partir de ahora `/shop` muestra solo tus propios ítems.';
    }
    await i.editReply({ content, embeds: [], components: [] });
    return;
  }

  // Edición: a diferencia de /shop-admin editar (que solo pisa lo que se completó,
  // porque sus opciones son todas opcionales), acá SIEMPRE se manda name/price/
  // description/category/roleId — el draft ya es el estado completo del ítem tal como
  // se ve en la vista previa, nunca un patch parcial. Efecto secundario correcto: a
  // diferencia del comando, este builder SÍ puede vaciar un rol ya asignado (roleId:
  // null pasa updateShopItem porque la clave está presente, ver shopStore.js).
  const updated = await updateShopItem(i.guildId, itemId, {
    name: draft.name,
    price: draft.price,
    description: draft.description || 'Sin descripción.',
    category: draft.category || 'General',
    roleId: draft.roleId || null,
  });
  await i.editReply({
    content: updated
      ? '✅ Ítem actualizado. Su id interno no cambió, así que el inventario de quien ya lo compró sigue funcionando.'
      : '❌ No se encontró ese ítem en tu tienda (¿se borró mientras editabas?).',
    embeds: [],
    components: [],
  });
});

export const data = new SlashCommandBuilder()
  .setName('shop-admin')
  .setDescription('Administra el catálogo de la tienda de este servidor.')
  .addSubcommand((sub) =>
    sub
      .setName('agregar')
      .setDescription('Agrega un ítem nuevo a la tienda.')
      .addStringOption((o) => o.setName('nombre').setDescription('Nombre del ítem').setRequired(true).setMaxLength(80))
      .addIntegerOption((o) => o.setName('precio').setDescription('Precio en monedas').setRequired(true).setMinValue(1))
      .addStringOption((o) => o.setName('descripcion').setDescription('Descripción que se ve en /shop').setRequired(false).setMaxLength(200))
      .addStringOption((o) => o.setName('categoria').setDescription('Categoría para agrupar en /shop (default: General)').setRequired(false).setMaxLength(40))
      .addRoleOption((o) => o.setName('rol').setDescription('Si lo completás, el rol se asigna solo al comprarlo').setRequired(false))
      .addBooleanOption((o) => o.setName('entrega_manual').setDescription('Si es true, el staff recibe un aviso para entregarlo a mano en vez de ser automático').setRequired(false))
      .addStringOption((o) =>
        o
          .setName('tipo')
          .setDescription('Comportamiento especial al comprarlo (dejalo vacío para un ítem normal)')
          .setRequired(false)
          .addChoices(
            { name: 'Impulso de XP (x2 por 24hs)', value: 'xp_boost' },
            { name: 'Caja misteriosa (monedas al azar)', value: 'mystery_box' },
            { name: 'Escudo anti-robo (protege de /rob por 2hs)', value: 'rob_shield' },
          ),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('quitar')
      .setDescription('Elimina un ítem de la tienda.')
      .addStringOption((o) => o.setName('item').setDescription('Qué ítem borrar (escribí para buscar)').setRequired(true).setAutocomplete(true)),
  )
  .addSubcommand((sub) => sub.setName('listar').setDescription('Muestra el catálogo actual con los IDs internos.'))
  .addSubcommand((sub) =>
    sub
      .setName('editar')
      .setDescription('Corrige un ítem existente sin cambiar su id (no rompe el inventario de quien ya lo compró).')
      .addStringOption((o) => o.setName('item').setDescription('Qué ítem editar (escribí para buscar)').setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName('nombre').setDescription('Nuevo nombre (opcional)').setRequired(false).setMaxLength(80))
      .addIntegerOption((o) => o.setName('precio').setDescription('Nuevo precio (opcional)').setRequired(false).setMinValue(1))
      .addStringOption((o) => o.setName('descripcion').setDescription('Nueva descripción (opcional)').setRequired(false).setMaxLength(200))
      .addStringOption((o) => o.setName('categoria').setDescription('Nueva categoría (opcional)').setRequired(false).setMaxLength(40))
      .addRoleOption((o) => o.setName('rol').setDescription('Nuevo rol a asignar (opcional)').setRequired(false)),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false);

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const items = await getGuildShopItems(interaction.guildId).catch(() => []);
  const matches = items
    .filter((item) => item.name.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((item) => ({ name: item.name.slice(0, 100), value: item.id }));

  await interaction.respond(matches);
}

export async function execute(interaction) {
  // Tier 2 (auditoría 2026-09-12, hallazgo de economía #1): /shop-admin puede crear un
  // ítem "caja misteriosa" que acredita monedas sin límite — la misma capacidad que
  // /economia-staff y /xp ya reservan a isAdmin(), no a isStaff() (Tier 1, moderador).
  if (!(await isAdmin(interaction))) {
    // Auditoría UX/UI (2026-09-18), hallazgo Importante del Top 20: el mensaje viejo
    // ("Solo un administrador...") sugería un permiso nativo de Discord — el gate real
    // es un ROL de NEXO (/config rol-admin), sin relación con "Gestionar servidor".
    await interaction.reply({ content: ADMIN_ONLY_MESSAGE, flags: MessageFlags.Ephemeral });
    return;
  }

  const sub = interaction.options.getSubcommand();
  if (sub === 'agregar') return handleAgregar(interaction);
  if (sub === 'quitar') return handleQuitar(interaction);
  if (sub === 'listar') return handleListar(interaction);
  if (sub === 'editar') return handleEditar(interaction);
}
