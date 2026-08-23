import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';

const FORTUNES = [
  'Hoy es tu día de suerte para jugar rankeds.',
  'Cuidado con las emboscadas hoy.',
  'Un buen loot te espera en tu próxima partida.',
  'Hoy no es el mejor día para apostar en /guess.',
  'La suerte está de tu lado en las próximas 24 horas.',
  'Mejor practicá puntería antes de la próxima scrim.',
];

export const data = new SlashCommandBuilder()
  .setName('lucky')
  .setDescription('Consultá tu número y frase de la suerte del día.')
  .setDMPermission(false);

export async function execute(interaction) {
  const numero = Math.floor(Math.random() * 100) + 1;
  const frase = FORTUNES[Math.floor(Math.random() * FORTUNES.length)];

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🍀 Tu suerte de hoy')
    .setDescription(`Número de la suerte: **${numero}**\n${frase}`)
    .setFooter({ text: BRAND_NAME });

  await interaction.reply({ embeds: [embed] });
}
