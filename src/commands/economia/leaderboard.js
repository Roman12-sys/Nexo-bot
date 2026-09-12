import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getGuildEconomyPage } from '../../utils/economyStore.js';
import { EMERALD_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { registerButtonPrefix } from '../../components/buttons.js';

const PAGE_SIZE = 10;
const MEDALS = ['🥇', '🥈', '🥉'];

// PERF-1 (plan de ejecución post-auditoría, Fase 3): antes traía la tabla economy
// ENTERA del servidor (con TODAS sus columnas, inventory incluido) y paginaba acá en JS
// — mismo patrón que tenía /ranking. getGuildEconomyPage pagina de verdad en el backend
// (COUNT + un solo `range()` por la página pedida, solo user_id/balance).
export async function buildLeaderboardEmbed(guildId, page) {
  const { rows: slice, clampedPage, totalPages } = await getGuildEconomyPage(guildId, { page, pageSize: PAGE_SIZE });

  const embed = new EmbedBuilder()
    .setColor(EMERALD_COLOR)
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
