import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('kitty')
  .setDescription('Muestra una foto random de un gato.')
  .setDMPermission(false);

// Sin costo real — comparte el cupo de rate limit más laxo de los comandos livianos.
export const rateLimitCategory = 'light';

export async function execute(interaction) {
  try {
    await interaction.deferReply();
    const response = await fetch('https://api.thecatapi.com/v1/images/search');
    if (!response.ok) throw new Error(`TheCatAPI respondió con estado ${response.status}`);

    const data = await response.json();
    const imageUrl = data[0]?.url;
    if (!imageUrl) throw new Error('No se recibió ninguna imagen.');

    const embed = new EmbedBuilder().setColor(BRAND_COLOR).setTitle('🐱 ¡Miau!').setImage(imageUrl).setFooter({ text: BRAND_NAME });
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('❌ Error al ejecutar /kitty:', error);
    await interaction.editReply({ content: '❌ No se pudo obtener la imagen en este momento.' });
  }
}
