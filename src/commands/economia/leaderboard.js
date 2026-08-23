import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getGuildEconomy } from '../../utils/economyStore.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Muestra el top de usuarios con más monedas.')
  .setDMPermission(false);

export async function execute(interaction) {
  await interaction.deferReply();

  const sorted = await getGuildEconomy(interaction.guild.id, { limit: 10 });

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🏆 Top de monedas')
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();

  if (sorted.length === 0) {
    embed.setDescription('Todavía nadie tiene monedas registradas.');
  } else {
    const medals = ['🥇', '🥈', '🥉'];
    const lines = sorted.map((data, index) => {
      const medal = medals[index] || `#${index + 1}`;
      return `${medal} <@${data.userId}> — **${data.balance.toLocaleString('es-ES')}** monedas`;
    });
    embed.setDescription(lines.join('\n'));
  }

  await interaction.editReply({ embeds: [embed] });
}
