import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { removeWarnAt, clearWarns } from '../../utils/warnsStore.js';
import { createUnwarnLogEmbed } from '../../utils/logEmbeds.js';
import { isStaff, getModerationBlockReason } from '../../utils/permissions.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';

export const data = new SlashCommandBuilder()
  .setName('unwarn')
  .setDescription('Quita una advertencia de un usuario.')
  .addUserOption((o) => o.setName('usuario').setDescription('Usuario').setRequired(true))
  .addIntegerOption((o) =>
    o.setName('numero').setDescription('Número de advertencia a quitar (ver con /warns). Si se omite, se borran todas.').setRequired(false).setMinValue(1),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!(await isStaff(interaction))) {
    await interaction.reply({ content: '❌ No tenés permisos para usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  const targetUser = interaction.options.getUser('usuario');
  const numero = interaction.options.getInteger('numero');

  await interaction.deferReply();

  try {
    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    const blockReason = getModerationBlockReason(interaction, member);
    if (blockReason) {
      await interaction.editReply({ content: blockReason });
      return;
    }

    const logChannel = await getGuildLogChannel(interaction.client, interaction.guildId, 'moderation');

    if (numero) {
      const removed = await removeWarnAt(interaction.guild.id, targetUser.id, numero);
      if (!removed) {
        await interaction.editReply({ content: '❌ No se encontró esa advertencia.' });
        return;
      }
      await interaction.editReply({ content: `✅ Se quitó la advertencia #${numero} de ${targetUser}.` });

      if (logChannel) {
        await logChannel.send({ embeds: [createUnwarnLogEmbed({ user: targetUser, executor: interaction.user, detail: `Advertencia #${numero} (${removed.reason})` })] });
      }
    } else {
      const total = await clearWarns(interaction.guild.id, targetUser.id);
      await interaction.editReply({ content: `✅ Se borraron las ${total} advertencia(s) de ${targetUser}.` });

      if (total > 0 && logChannel) {
        await logChannel.send({ embeds: [createUnwarnLogEmbed({ user: targetUser, executor: interaction.user, detail: `Se borraron todas (${total})` })] });
      }
    }
  } catch (error) {
    console.error('❌ Error al ejecutar /unwarn:', error);
    const errorMsg = { content: '❌ Ocurrió un error al quitar la(s) advertencia(s).', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMsg);
    } else {
      await interaction.reply(errorMsg);
    }
  }
}
