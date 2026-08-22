import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { addWarn } from '../../utils/warnsStore.js';
import { createWarnLogEmbed } from '../../utils/logEmbeds.js';
import { isStaff, getModerationBlockReason } from '../../utils/permissions.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';

export const data = new SlashCommandBuilder()
  .setName('warn')
  .setDescription('Aplica una advertencia a un usuario.')
  .addUserOption((o) => o.setName('usuario').setDescription('Usuario a advertir').setRequired(true))
  .addStringOption((o) => o.setName('motivo').setDescription('Motivo de la advertencia').setRequired(true).setMaxLength(512))
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!(await isStaff(interaction))) {
    await interaction.reply({ content: '❌ No tenés permisos para usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  const targetUser = interaction.options.getUser('usuario');
  const motivo = interaction.options.getString('motivo');

  await interaction.deferReply();

  try {
    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    const blockReason = getModerationBlockReason(interaction, member);
    if (blockReason) {
      await interaction.editReply({ content: blockReason });
      return;
    }

    const warn = { reason: motivo, moderatorId: interaction.user.id };
    const list = await addWarn(interaction.guild.id, targetUser.id, warn);

    await interaction.editReply({ content: `✅ Se advirtió a ${targetUser} (advertencia #${list.length}). Motivo: ${motivo}` });

    const logChannel = await getGuildLogChannel(interaction.client, interaction.guildId, 'moderation');
    if (logChannel) {
      await logChannel.send({ embeds: [createWarnLogEmbed({ user: targetUser, executor: interaction.user, reason: motivo, total: list.length })] });
    }
  } catch (error) {
    console.error('❌ Error al ejecutar /warn:', error);
    const errorMsg = { content: '❌ Ocurrió un error al aplicar la advertencia.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMsg);
    } else {
      await interaction.reply(errorMsg);
    }
  }
}
