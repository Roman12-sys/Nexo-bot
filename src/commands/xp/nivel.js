import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getUserXp, getLevelProgress, getRank } from '../../utils/xpStore.js';
import { BRAND_COLOR, BRAND_NAME, buildProgressBar, progressPercent } from '../../utils/embeds.js';

export async function buildNivelEmbed(guildId, targetUser) {
  const record = await getUserXp(guildId, targetUser.id);
  const progress = getLevelProgress(record.xp);
  const rank = await getRank(guildId, targetUser.id);
  const pct = progressPercent(progress.currentLevelXp, progress.xpForNextLevel);

  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setAuthor({ name: targetUser.tag, iconURL: targetUser.displayAvatarURL() })
    .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: '⭐ Nivel', value: `${progress.level}`, inline: true },
      { name: '🏆 Ranking', value: rank ? `#${rank}` : 'Sin actividad todavía', inline: true },
      {
        name: '✨ XP',
        value: `${progress.currentLevelXp.toLocaleString('es-ES')} / ${progress.xpForNextLevel.toLocaleString('es-ES')}`,
        inline: true,
      },
      { name: 'Progreso al siguiente nivel', value: `${buildProgressBar(progress.currentLevelXp, progress.xpForNextLevel)} ${pct}%` },
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();
}

export const data = new SlashCommandBuilder()
  .setName('nivel')
  .setDescription('Muestra tu nivel y progreso de XP (o el de otro usuario).')
  .addUserOption((o) => o.setName('usuario').setDescription('Usuario a consultar (opcional)').setRequired(false))
  .setDMPermission(false);

export async function execute(interaction) {
  await interaction.deferReply();
  const targetUser = interaction.options.getUser('usuario') || interaction.user;
  const embed = await buildNivelEmbed(interaction.guild.id, targetUser);
  await interaction.editReply({ embeds: [embed] });
}
