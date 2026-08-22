import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { createBanLogEmbed } from '../../utils/logEmbeds.js';
import { isStaff, getModerationBlockReason } from '../../utils/permissions.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';

export const data = new SlashCommandBuilder()
  .setName('ban')
  .setDescription('Banea a un usuario del servidor.')
  .addUserOption((o) => o.setName('usuario').setDescription('Usuario a banear').setRequired(true))
  .addStringOption((o) => o.setName('motivo').setDescription('Motivo').setRequired(false).setMaxLength(512))
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!(await isStaff(interaction))) {
    await interaction.reply({ content: '❌ No tenés permisos para usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  const targetUser = interaction.options.getUser('usuario');
  const motivo = interaction.options.getString('motivo') || 'Sin motivo especificado';

  try {
    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    const blockReason = getModerationBlockReason(interaction, member);
    if (blockReason) {
      await interaction.reply({ content: blockReason, flags: MessageFlags.Ephemeral });
      return;
    }

    if (member && !member.bannable) {
      await interaction.reply({ content: '❌ No puedo banear a este usuario (puede tener un rol más alto que el mío).', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.guild.members.ban(targetUser.id, { reason: motivo });
    await interaction.reply({ content: `✅ Se baneó a ${targetUser.tag}.` });

    const logChannel = await getGuildLogChannel(interaction.client, interaction.guildId, 'moderation');
    if (logChannel) {
      await logChannel.send({ embeds: [createBanLogEmbed({ user: targetUser, executor: interaction.user, reason: motivo })] });
    }
  } catch (error) {
    console.error('❌ Error al ejecutar /ban:', error);
    const errorMsg = { content: '❌ Ocurrió un error al banear al usuario.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMsg);
    } else {
      await interaction.reply(errorMsg);
    }
  }
}
