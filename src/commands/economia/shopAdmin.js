import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { getGuildShopItems, addShopItem, updateShopItem, removeShopItem, hasCustomShopItems } from '../../utils/shopStore.js';
import { isStaff } from '../../utils/permissions.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { registerButtonPrefix } from '../../components/buttons.js';

async function handleAgregar(interaction) {
  const name = interaction.options.getString('nombre');
  const price = interaction.options.getInteger('precio');
  const description = interaction.options.getString('descripcion') || 'Sin descripción.';
  const category = interaction.options.getString('categoria') || 'General';
  const role = interaction.options.getRole('rol');
  const manual = interaction.options.getBoolean('entrega_manual') ?? false;
  const tipo = interaction.options.getString('tipo') || null;

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
    .setColor(BRAND_COLOR)
    .setTitle('📦 Catálogo de la tienda')
    .setFooter({ text: `${BRAND_NAME} • Página ${clampedPage + 1}/${totalPages} • Usá el id (\`...\`) en /shop-admin quitar/editar` })
    .setTimestamp();

  if (items.length === 0) {
    embed.setDescription('No hay ítems configurados.');
  } else {
    embed.addFields(
      slice.map((i) => ({
        name: i.name,
        value: `${i.price.toLocaleString('es-ES')} monedas · \`${i.id}\`${i.roleId ? ` · rol <@&${i.roleId}>` : ''}${i.fulfillment === 'manual' ? ' · entrega manual' : ''}${i.type === 'xp_boost' ? ' · ⚡ impulso de XP' : ''}${i.type === 'mystery_box' ? ' · 🎁 caja misteriosa' : ''}`,
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

async function handleListar(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const items = await getGuildShopItems(interaction.guildId);
  const { embed, clampedPage, totalPages } = buildListarEmbed(items, 0);
  const components = totalPages > 1 ? [buildListarRow(clampedPage, totalPages)] : [];
  await interaction.editReply({ embeds: [embed], components });
}

registerButtonPrefix('shopadmin_listar_page_', async (i) => {
  if (!(await isStaff(i))) return i.reply({ content: '❌ No tenés permisos.', flags: MessageFlags.Ephemeral });
  const page = parseInt(i.customId.slice('shopadmin_listar_page_'.length), 10);
  const items = await getGuildShopItems(i.guildId);
  const { embed, clampedPage, totalPages } = buildListarEmbed(items, page);
  await i.update({ embeds: [embed], components: [buildListarRow(clampedPage, totalPages)] });
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
  if (!(await isStaff(interaction))) {
    await interaction.reply({ content: '❌ No tenés permisos para usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  const sub = interaction.options.getSubcommand();
  if (sub === 'agregar') return handleAgregar(interaction);
  if (sub === 'quitar') return handleQuitar(interaction);
  if (sub === 'listar') return handleListar(interaction);
  if (sub === 'editar') return handleEditar(interaction);
}
