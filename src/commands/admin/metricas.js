import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { isStaff } from '../../utils/permissions.js';
import { getTopCommands, getTotalUsage } from '../../utils/commandUsageStore.js';
import { BRAND_COLOR, BRAND_NAME, buildProgressBar } from '../../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('metricas')
  .setDescription('Muestra los comandos más usados de este servidor.')
  .setDMPermission(false);

export async function execute(interaction) {
  if (!(await isStaff(interaction))) {
    await interaction.reply({ content: '❌ Solo el staff puede ver las métricas del servidor.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const [top, total] = await Promise.all([getTopCommands(interaction.guildId, 10), getTotalUsage(interaction.guildId)]);

  if (top.length === 0) {
    await interaction.editReply('📊 Todavía no hay uso registrado en este servidor.');
    return;
  }

  const maxUses = top[0].uses;
  const lines = top.map((row, i) => {
    const bar = buildProgressBar(row.uses, maxUses, 10);
    return `**${i + 1}.** \`/${row.command_name}\` ${bar} — **${row.uses}** usos`;
  });

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('📊 Comandos más usados')
    .setDescription(lines.join('\n'))
    .setFooter({ text: `${BRAND_NAME} • ${total} comandos ejecutados en total` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
