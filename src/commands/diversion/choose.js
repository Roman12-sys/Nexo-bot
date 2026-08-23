import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('choose')
  .setDescription('El bot elige una opción al azar por vos.')
  .addStringOption((o) => o.setName('opciones').setDescription('Separá las opciones con comas. Ej: pizza, sushi, milanesa').setRequired(true))
  .setDMPermission(false);

export async function execute(interaction) {
  const raw = interaction.options.getString('opciones');
  const opciones = raw.split(',').map((o) => o.trim()).filter((o) => o.length > 0);

  if (opciones.length < 2) {
    await interaction.reply({ content: '❌ Necesitás darme al menos 2 opciones separadas por comas.', flags: MessageFlags.Ephemeral });
    return;
  }

  const elegida = opciones[Math.floor(Math.random() * opciones.length)];

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setDescription(`🤔 Entre: ${opciones.join(', ')}\n\n**Elijo: ${elegida}**`)
    .setFooter({ text: BRAND_NAME });

  await interaction.reply({ embeds: [embed] });
}
