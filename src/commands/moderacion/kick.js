import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { createKickLogEmbed } from '../../utils/logEmbeds.js';
import { isStaff, getModerationBlockReason } from '../../utils/permissions.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';

export const data = new SlashCommandBuilder()
  .setName('kick')
  .setDescription('Expulsa a un usuario del servidor.')
  .addUserOption((o) => o.setName('usuario').setDescription('Usuario a expulsar').setRequired(true))
  .addStringOption((o) => o.setName('motivo').setDescription('Motivo').setRequired(false).setMaxLength(512))
  .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!(await isStaff(interaction))) {
    await interaction.reply({ content: '❌ No tenés permisos para usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  const targetUser = interaction.options.getUser('usuario');
  const motivo = interaction.options.getString('motivo') || 'Sin motivo especificado';

  const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!member) {
    await interaction.reply({ content: '❌ No se encontró a ese usuario en el servidor.', flags: MessageFlags.Ephemeral });
    return;
  }

  const blockReason = getModerationBlockReason(interaction, member);
  if (blockReason) {
    await interaction.reply({ content: blockReason, flags: MessageFlags.Ephemeral });
    return;
  }

  if (!member.kickable) {
    await interaction.reply({ content: '❌ No puedo expulsar a este usuario (puede tener un rol más alto que el mío).', flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    await member.kick(motivo);
    await interaction.reply({ content: `✅ Se expulsó a ${targetUser.tag}.` });

    const logChannel = await getGuildLogChannel(interaction.client, interaction.guildId, 'moderation');
    if (logChannel) {
      await logChannel.send({ embeds: [createKickLogEmbed({ user: targetUser, executor: interaction.user, reason: motivo })] });
    }
  } catch (error) {
    console.error('❌ Error al ejecutar /kick:', error);
    const errorMsg = { content: '❌ Ocurrió un error al expulsar al usuario.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMsg);
    } else {
      await interaction.reply(errorMsg);
    }
  }
}
