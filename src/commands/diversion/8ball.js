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
  // QUÉ CAMBIÓ: setMaxLength(200) — antes no tenía límite (Discord permite hasta 6000
  // por defecto en un string option), y la pregunta se pega tal cual en el VALUE de un
  // campo de embed (límite real: 1024). Una pregunta larga rompía el embed entero con un
  // error de Discord sin manejar ("Hubo un error ejecutando este comando", sin pista de
  // qué pasó). 200 deja margen de sobra para una pregunta real sin acercarse al límite.
  // MOTIVO: auditoría Fase 2B, sección 6.
  .addStringOption((o) => o.setName('pregunta').setDescription('Tu pregunta').setRequired(true).setMaxLength(200))
  .setDMPermission(false);

// Sin costo real — comparte el cupo de rate limit más laxo de los comandos livianos.
export const rateLimitCategory = 'light';

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
