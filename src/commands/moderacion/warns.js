import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { getUserWarns } from '../../utils/warnsStore.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';

export const data = new SlashCommandBuilder()
  .setName('warns')
  .setDescription('Muestra las advertencias de un usuario.')
  .addUserOption((o) => o.setName('usuario').setDescription('Usuario').setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!(await isStaff(interaction))) {
    await interaction.reply({ content: '❌ No tenés permisos para usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const targetUser = interaction.options.getUser('usuario');
    const list = await getUserWarns(interaction.guild.id, targetUser.id);

    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle(`⚠️ Advertencias de ${targetUser.tag}`)
      .setFooter({ text: BRAND_NAME })
      .setTimestamp();

    embed.setDescription(
      list.length === 0
        ? 'Este usuario no tiene advertencias.'
        : list.map((w, i) => `**#${i + 1}** — ${w.reason}\n<t:${Math.floor(w.timestamp / 1000)}:f> · por <@${w.moderatorId}>`).join('\n\n'),
    );

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('❌ Error al ejecutar /warns:', error);
    await interaction.editReply({ content: '❌ Ocurrió un error al obtener las advertencias.' });
  }
}
