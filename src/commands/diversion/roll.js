import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('roll')
  .setDescription('Tirá uno o varios dados.')
  .addIntegerOption((o) => o.setName('caras').setDescription('Cantidad de caras del dado (por defecto 6)').setRequired(false).setMinValue(2).setMaxValue(1000))
  .addIntegerOption((o) => o.setName('cantidad').setDescription('Cuántos dados tirar (por defecto 1)').setRequired(false).setMinValue(1).setMaxValue(20))
  .setDMPermission(false);

export async function execute(interaction) {
  const caras = interaction.options.getInteger('caras') || 6;
  const cantidad = interaction.options.getInteger('cantidad') || 1;

  const resultados = [];
  for (let i = 0; i < cantidad; i++) {
    resultados.push(Math.floor(Math.random() * caras) + 1);
  }
  const total = resultados.reduce((sum, n) => sum + n, 0);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`🎲 ${cantidad}d${caras}`)
    .setDescription(`Resultados: ${resultados.join(', ')}${cantidad > 1 ? `\n**Total: ${total}**` : ''}`)
    .setFooter({ text: BRAND_NAME });

  await interaction.reply({ embeds: [embed] });
}
