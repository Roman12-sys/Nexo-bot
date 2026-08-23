import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getGuildShopItems } from '../../utils/shopStore.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { registerButtonPrefix } from '../../components/buttons.js';

// Antes armaba UN embed con TODAS las categorías juntas — un catálogo grande (varios
// ítems propios por servidor) podía superar el límite de caracteres de un embed sin
// ningún aviso. Ahora pagina por categoría, una por página, mismo patrón de botones que
// /ranking y /leaderboard.
async function buildShopEmbed(guildId, page) {
  const items = await getGuildShopItems(guildId);

  const categories = {};
  for (const item of items) {
    if (!categories[item.category]) categories[item.category] = [];
    categories[item.category].push(item);
  }
  const categoryNames = Object.keys(categories);

  const totalPages = Math.max(1, categoryNames.length);
  const clampedPage = Math.min(Math.max(0, page), totalPages - 1);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🛒 Tienda')
    .setDescription('Usá `/buy` y elegí el ítem que quieras (con autocompletado).')
    .setFooter({ text: categoryNames.length > 0 ? `${BRAND_NAME} • Página ${clampedPage + 1}/${totalPages}` : BRAND_NAME })
    .setTimestamp();

  if (categoryNames.length === 0) {
    embed.addFields({ name: 'Sin ítems', value: 'Todavía no hay nada en la tienda de este servidor.' });
  } else {
    const category = categoryNames[clampedPage];
    const value = categories[category]
      .map((item) => `**${item.name}** — ${item.price.toLocaleString('es-ES')} monedas\n${item.description}`)
      .join('\n\n');
    embed.addFields({ name: `📦 ${category}`, value: value.slice(0, 1024) });
  }

  return { embed, clampedPage, totalPages };
}

function buildShopRow(clampedPage, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`shop_page_${clampedPage - 1}`)
      .setLabel('◀️ Categoría anterior')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clampedPage <= 0),
    new ButtonBuilder()
      .setCustomId(`shop_page_${clampedPage + 1}`)
      .setLabel('Siguiente categoría ▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clampedPage >= totalPages - 1),
  );
}

export const data = new SlashCommandBuilder()
  .setName('shop')
  .setDescription('Muestra los ítems disponibles en la tienda.')
  .setDMPermission(false);

export async function execute(interaction) {
  await interaction.deferReply();
  const { embed, clampedPage, totalPages } = await buildShopEmbed(interaction.guildId, 0);
  const components = totalPages > 1 ? [buildShopRow(clampedPage, totalPages)] : [];
  await interaction.editReply({ embeds: [embed], components });
}

registerButtonPrefix('shop_page_', async (interaction) => {
  const page = parseInt(interaction.customId.slice('shop_page_'.length), 10);
  const { embed, clampedPage, totalPages } = await buildShopEmbed(interaction.guildId, page);
  await interaction.update({ embeds: [embed], components: [buildShopRow(clampedPage, totalPages)] });
});
