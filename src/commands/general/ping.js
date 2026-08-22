import { SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Responde pong (test de que el bot está vivo).');

export async function execute(interaction) {
  await interaction.reply(`Pong! ${interaction.client.ws.ping}ms`);
}
