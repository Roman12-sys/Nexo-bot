import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';

const RESPONSES = [
  'Sí, definitivamente.', 'Es cierto.', 'Sin duda alguna.', 'Sí, podés confiar en ello.',
  'Como yo lo veo, sí.', 'Muy probable.', 'Las perspectivas son buenas.', 'Sí.',
  'Las señales apuntan a que sí.', 'Respuesta confusa, intentá de nuevo.', 'Preguntá de nuevo más tarde.',
  'Mejor no te lo digo ahora.', 'No puedo predecirlo ahora.', 'Concentrate y preguntá de nuevo.',
  'No cuentes con ello.', 'Mi respuesta es no.', 'Mis fuentes dicen que no.',
  'Las perspectivas no son tan buenas.', 'Muy dudoso.',
];

export const data = new SlashCommandBuilder()
  .setName('8ball')
  .setDescription('Le preguntás algo a la bola mágica.')
  .addStringOption((o) => o.setName('pregunta').setDescription('Tu pregunta').setRequired(true))
  .setDMPermission(false);

export async function execute(interaction) {
  const pregunta = interaction.options.getString('pregunta');
  const respuesta = RESPONSES[Math.floor(Math.random() * RESPONSES.length)];

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🎱 Bola mágica')
    .addFields({ name: 'Pregunta', value: pregunta }, { name: 'Respuesta', value: respuesta })
    .setFooter({ text: BRAND_NAME });

  await interaction.reply({ embeds: [embed] });
}
