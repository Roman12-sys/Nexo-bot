import { SlashCommandBuilder } from 'discord.js';

const BANANA_MESSAGES = [
  '🍌 Aquí tenés tu banana del día.',
  '🍌 ¡BANANA! (no preguntes por qué)',
  '🍌 La banana ha hablado.',
  '🍌 Nada que ver, solo pasaba una banana por acá.',
  '🍌 Banana suprema desbloqueada.',
  '🍌 Se te cayó esto: 🍌',
];

export const data = new SlashCommandBuilder()
  .setName('banana')
  .setDescription('Comando sin ningún sentido, pero divertido.')
  .setDMPermission(false);

// Sin costo real — comparte el cupo de rate limit más laxo de los comandos livianos.
export const rateLimitCategory = 'light';

export async function execute(interaction) {
  const mensaje = BANANA_MESSAGES[Math.floor(Math.random() * BANANA_MESSAGES.length)];
  await interaction.reply({ content: mensaje });
}
