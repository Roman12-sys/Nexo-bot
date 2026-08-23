import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getGuildEconomy } from '../../utils/economyStore.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { registerButtonPrefix } from '../../components/buttons.js';

const PAGE_SIZE = 10;
const MEDALS = ['🥇', '🥈', '🥉'];

// Mismo patrón que buildRankingEmbed (xp/ranking.js) — antes esto cortaba directo en el
// top 10 sin forma de ver más.
export async function buildLeaderboardEmbed(guildId, page) {
  const sorted = await getGuildEconomy(guildId);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const clampedPage = Math.min(Math.max(0, page), totalPages - 1);
  const slice = sorted.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🏆 Top de monedas')
    .setFooter({ text: `${BRAND_NAME} • Página ${clampedPage + 1}/${totalPages}` })
    .setTimestamp();

  if (slice.length === 0) {
    embed.setDescription('Todavía nadie tiene monedas registradas.');
  } else {
    const lines = slice.map((data, i) => {
      const globalIndex = clampedPage * PAGE_SIZE + i;
      const medal = MEDALS[globalIndex] || `${globalIndex + 1}.`;
      return `${medal} <@${data.userId}> — **${data.balance.toLocaleString('es-ES')}** monedas`;
    });
    embed.setDescription(lines.join('\n'));
  }

  return { embed, clampedPage, totalPages };
}

export function buildLeaderboardRow(clampedPage, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`leaderboard_page_${clampedPage - 1}`)
      .setLabel('◀️ Anterior')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clampedPage <= 0),
    new ButtonBuilder()
      .setCustomId(`leaderboard_page_${clampedPage + 1}`)
      .setLabel('Siguiente ▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clampedPage >= totalPages - 1),
  );
}

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Muestra el top de usuarios con más monedas.')
  .setDMPermission(false);

export async function execute(interaction) {
  await interaction.deferReply();
  const { embed, clampedPage, totalPages } = await buildLeaderboardEmbed(interaction.guild.id, 0);
  await interaction.editReply({ embeds: [embed], components: [buildLeaderboardRow(clampedPage, totalPages)] });
}

registerButtonPrefix('leaderboard_page_', async (interaction) => {
  const page = parseInt(interaction.customId.slice('leaderboard_page_'.length), 10);
  const { embed, clampedPage, totalPages } = await buildLeaderboardEmbed(interaction.guild.id, page);
  await interaction.update({ embeds: [embed], components: [buildLeaderboardRow(clampedPage, totalPages)] });
});
