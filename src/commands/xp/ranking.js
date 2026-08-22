import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getGuildXp } from '../../utils/xpStore.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { registerButtonPrefix } from '../../components/buttons.js';

const PAGE_SIZE = 10;
const MEDALS = ['🥇', '🥈', '🥉'];

export async function buildRankingEmbed(guildId, page) {
  const sorted = (await getGuildXp(guildId)).filter((data) => data.xp > 0);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const clampedPage = Math.min(Math.max(0, page), totalPages - 1);
  const slice = sorted.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🏆 Ranking de Niveles')
    .setFooter({ text: `${BRAND_NAME} • Página ${clampedPage + 1}/${totalPages}` })
    .setTimestamp();

  if (slice.length === 0) {
    embed.setDescription('Todavía nadie ganó XP.');
  } else {
    const lines = slice.map((data, i) => {
      const globalIndex = clampedPage * PAGE_SIZE + i;
      const medal = MEDALS[globalIndex] || `${globalIndex + 1}.`;
      return `${medal} <@${data.userId}> — Nivel **${data.level}** — **${data.xp.toLocaleString('es-ES')}** XP`;
    });
    embed.setDescription(lines.join('\n'));
  }

  return { embed, clampedPage, totalPages };
}

export function buildRankingRow(clampedPage, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ranking_page_${clampedPage - 1}`)
      .setLabel('◀️ Anterior')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clampedPage <= 0),
    new ButtonBuilder()
      .setCustomId(`ranking_page_${clampedPage + 1}`)
      .setLabel('Siguiente ▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clampedPage >= totalPages - 1),
  );
}

export const data = new SlashCommandBuilder()
  .setName('ranking')
  .setDescription('Muestra el ranking de niveles/XP del servidor.')
  .setDMPermission(false);

export async function execute(interaction) {
  await interaction.deferReply();
  const { embed, clampedPage, totalPages } = await buildRankingEmbed(interaction.guild.id, 0);
  await interaction.editReply({ embeds: [embed], components: [buildRankingRow(clampedPage, totalPages)] });
}

registerButtonPrefix('ranking_page_', async (interaction) => {
  const page = parseInt(interaction.customId.slice('ranking_page_'.length), 10);
  const { embed, clampedPage, totalPages } = await buildRankingEmbed(interaction.guild.id, page);
  await interaction.update({ embeds: [embed], components: [buildRankingRow(clampedPage, totalPages)] });
});
