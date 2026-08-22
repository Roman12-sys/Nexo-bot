import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import SHOP_ITEMS from '../../utils/shopItems.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('shop')
  .setDescription('Muestra los ítems disponibles en la tienda.')
  .setDMPermission(false);

export async function execute(interaction) {
  const categories = {};
  for (const item of SHOP_ITEMS) {
    if (!categories[item.category]) categories[item.category] = [];
    categories[item.category].push(item);
  }

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🛒 Tienda')
    .setDescription('Usá `/buy` y elegí el ítem que quieras del desplegable.')
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();

  for (const [category, items] of Object.entries(categories)) {
    const value = items
      .map((item) => `**${item.name}** — ${item.price.toLocaleString('es-ES')} monedas\n${item.description}`)
      .join('\n\n');
    embed.addFields({ name: `📦 ${category}`, value });
  }

  await interaction.reply({ embeds: [embed] });
}
