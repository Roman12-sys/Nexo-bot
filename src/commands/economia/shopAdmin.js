import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { getGuildShopItems, addShopItem, removeShopItem, hasCustomShopItems } from '../../utils/shopStore.js';
import { isStaff } from '../../utils/permissions.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';

async function handleAgregar(interaction) {
  const name = interaction.options.getString('nombre');
  const price = interaction.options.getInteger('precio');
  const description = interaction.options.getString('descripcion') || 'Sin descripción.';
  const category = interaction.options.getString('categoria') || 'General';
  const role = interaction.options.getRole('rol');
  const manual = interaction.options.getBoolean('entrega_manual') ?? false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const wasUsingDefaults = !(await hasCustomShopItems(interaction.guildId));

  const itemId = await addShopItem(interaction.guildId, {
    name,
    description,
    category,
    price,
    roleId: role?.id || null,
    fulfillment: manual ? 'manual' : null,
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

async function handleListar(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const items = await getGuildShopItems(interaction.guildId);
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('📦 Catálogo de la tienda')
    .setFooter({ text: `${BRAND_NAME} • Usá el nombre exacto en /shop-admin quitar` })
    .setTimestamp();

  if (items.length === 0) {
    embed.setDescription('No hay ítems configurados.');
  } else {
    embed.setDescription(
      items.map((i) => `**${i.name}** — ${i.price.toLocaleString('es-ES')} monedas · \`${i.id}\`${i.roleId ? ` · rol <@&${i.roleId}>` : ''}`).join('\n'),
    );
  }

  await interaction.editReply({ embeds: [embed] });
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
      .addBooleanOption((o) => o.setName('entrega_manual').setDescription('Si es true, el staff recibe un aviso para entregarlo a mano en vez de ser automático').setRequired(false)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('quitar')
      .setDescription('Elimina un ítem de la tienda.')
      .addStringOption((o) => o.setName('item').setDescription('Qué ítem borrar (escribí para buscar)').setRequired(true).setAutocomplete(true)),
  )
  .addSubcommand((sub) => sub.setName('listar').setDescription('Muestra el catálogo actual con los IDs internos.'))
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
}
