import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { getUserReputation, addReputation, touchLastGiven, getGuildReputation } from '../../utils/reputationStore.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { withLock } from '../../utils/asyncLock.js';
import { unlockAchievement, announceUnlockedAchievements } from '../../utils/achievements.js';
import { registerButtonPrefix } from '../../components/buttons.js';

const COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 horas entre cada vez que PODÉS dar reputación
const PAGE_SIZE = 10;
const MEDALS = ['🥇', '🥈', '🥉'];

async function handleDar(interaction) {
  const targetUser = interaction.options.getUser('usuario');
  const guildId = interaction.guild.id;

  if (targetUser.id === interaction.user.id) {
    await interaction.reply({ content: '❌ No podés darte reputación a vos mismo.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (targetUser.bot) {
    await interaction.reply({ content: '❌ No podés darle reputación a un bot.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply();

  // Check de cooldown + reclamo dentro de un lock por usuario (mismo motivo que /daily
  // y /work): sin esto, dos /reputation casi simultáneos del mismo usuario dador pueden
  // leer el mismo lastGiven viejo antes de que el primero llegue a actualizarlo.
  const result = await withLock(`reputation:${guildId}:${interaction.user.id}`, async () => {
    const giver = await getUserReputation(guildId, interaction.user.id);
    const now = Date.now();
    const elapsed = now - giver.lastGiven;

    if (elapsed < COOLDOWN_MS) {
      return { onCooldown: true, remaining: COOLDOWN_MS - elapsed, now };
    }

    // touchLastGiven solo toca la columna del cooldown del que da; addReputation suma
    // el punto de forma atómica — ninguna de las dos puede pisar un cambio concurrente
    // del total de cualquiera de los dos usuarios (ej. otro /reputation al mismo receptor).
    await touchLastGiven(guildId, interaction.user.id, now);
    const newTotal = await addReputation(guildId, targetUser.id, 1);

    return { onCooldown: false, newTotal };
  });

  if (result.onCooldown) {
    const readyTimestamp = Math.floor((result.now + result.remaining) / 1000);
    await interaction.editReply({
      content: `⏳ Ya diste reputación hace poco. Podés volver a dar <t:${readyTimestamp}:R>.`,
    });
    return;
  }

  const { newTotal } = result;
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setDescription(`⭐ ${interaction.user} le dio un punto de reputación a ${targetUser}.\n${targetUser.tag} ahora tiene **${newTotal}** punto(s) de reputación.`)
    .setFooter({ text: BRAND_NAME });

  await interaction.editReply({ embeds: [embed] });

  if (newTotal >= 10) {
    await announceUnlockedAchievements(interaction, targetUser.id, [
      unlockAchievement(guildId, targetUser.id, 'querido'),
    ]);
  }
}

// Mismo patrón que buildRankingEmbed (xp/ranking.js) / buildLeaderboardEmbed
// (economia/leaderboard.js) — antes no existía NINGÚN comando para ver el top de
// reputación del servidor, solo tu propio total vía /perfil.
export async function buildReputationRankingEmbed(guildId, page) {
  const sorted = (await getGuildReputation(guildId)).filter((data) => data.total > 0);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const clampedPage = Math.min(Math.max(0, page), totalPages - 1);
  const slice = sorted.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🏆 Ranking de Reputación')
    .setFooter({ text: `${BRAND_NAME} • Página ${clampedPage + 1}/${totalPages}` })
    .setTimestamp();

  if (slice.length === 0) {
    embed.setDescription('Todavía nadie tiene reputación.');
  } else {
    const lines = slice.map((data, i) => {
      const globalIndex = clampedPage * PAGE_SIZE + i;
      const medal = MEDALS[globalIndex] || `${globalIndex + 1}.`;
      return `${medal} <@${data.userId}> — **${data.total}** punto(s)`;
    });
    embed.setDescription(lines.join('\n'));
  }

  return { embed, clampedPage, totalPages };
}

function buildReputationRankingRow(clampedPage, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`reputation_ranking_page_${clampedPage - 1}`)
      .setLabel('◀️ Anterior')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clampedPage <= 0),
    new ButtonBuilder()
      .setCustomId(`reputation_ranking_page_${clampedPage + 1}`)
      .setLabel('Siguiente ▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clampedPage >= totalPages - 1),
  );
}

async function handleRanking(interaction) {
  await interaction.deferReply();
  const { embed, clampedPage, totalPages } = await buildReputationRankingEmbed(interaction.guild.id, 0);
  await interaction.editReply({ embeds: [embed], components: [buildReputationRankingRow(clampedPage, totalPages)] });
}

export const data = new SlashCommandBuilder()
  .setName('reputation')
  .setDescription('Sistema de reputación entre miembros del servidor.')
  .addSubcommand((sub) =>
    sub
      .setName('dar')
      .setDescription('Le das un punto de reputación a otro usuario.')
      .addUserOption((o) => o.setName('usuario').setDescription('A quién le das reputación').setRequired(true)),
  )
  .addSubcommand((sub) => sub.setName('ranking').setDescription('Muestra el top de reputación del servidor.'))
  .setDMPermission(false);

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'dar') return handleDar(interaction);
  if (sub === 'ranking') return handleRanking(interaction);
}

registerButtonPrefix('reputation_ranking_page_', async (interaction) => {
  const page = parseInt(interaction.customId.slice('reputation_ranking_page_'.length), 10);
  const { embed, clampedPage, totalPages } = await buildReputationRankingEmbed(interaction.guild.id, page);
  await interaction.update({ embeds: [embed], components: [buildReputationRankingRow(clampedPage, totalPages)] });
});
