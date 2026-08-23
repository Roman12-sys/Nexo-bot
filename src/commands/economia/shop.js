import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getGuildShopItems } from '../../utils/shopStore.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('shop')
  .setDescription('Muestra los ítems disponibles en la tienda.')
  .setDMPermission(false);

export async function execute(interaction) {
  await interaction.deferReply();

  const items = await getGuildShopItems(interaction.guildId);

  const categories = {};
  for (const item of items) {
    if (!categories[item.category]) categories[item.category] = [];
    categories[item.category].push(item);
  }

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🛒 Tienda')
    .setDescription('Usá `/buy` y elegí el ítem que quieras (con autocompletado).')
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();

  for (const [category, categoryItems] of Object.entries(categories)) {
    const value = categoryItems
      .map((item) => `**${item.name}** — ${item.price.toLocaleString('es-ES')} monedas\n${item.description}`)
      .join('\n\n');
    embed.addFields({ name: `📦 ${category}`, value: value.slice(0, 1024) });
  }

  await interaction.editReply({ embeds: [embed] });
}
