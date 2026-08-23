import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('pupper')
  .setDescription('Muestra una foto random de un perro.')
  .setDMPermission(false);

export async function execute(interaction) {
  try {
    await interaction.deferReply();
    const response = await fetch('https://dog.ceo/api/breeds/image/random');
    if (!response.ok) throw new Error(`Dog CEO API respondió con estado ${response.status}`);

    const data = await response.json();
    const imageUrl = data.message;
    if (!imageUrl) throw new Error('No se recibió ninguna imagen.');

    const embed = new EmbedBuilder().setColor(BRAND_COLOR).setTitle('🐶 ¡Guau!').setImage(imageUrl).setFooter({ text: BRAND_NAME });
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('❌ Error al ejecutar /pupper:', error);
    await interaction.editReply({ content: '❌ No se pudo obtener la imagen en este momento.' });
  }
}
