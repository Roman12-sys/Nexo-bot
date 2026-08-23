import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { createBanLogEmbed } from '../../utils/logEmbeds.js';
import { isStaff, getModerationBlockReason } from '../../utils/permissions.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';
import { buildConfirmation } from '../../utils/confirmations.js';
import { describeError } from '../../utils/errorMessages.js';

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

    const confirmation = buildConfirmation({
      userId: interaction.user.id,
      guildId: interaction.guildId,
      description: `Vas a banear a **${targetUser.tag}**.\nMotivo: ${motivo}`,
      run: (i) => confirmBan(i, targetUser, motivo),
    });
    await interaction.reply(confirmation);
  } catch (error) {
    console.error('❌ Error al ejecutar /ban:', error);
    const errorMsg = { content: describeError(error, '❌ Ocurrió un error al banear al usuario.'), flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMsg);
    } else {
      await interaction.reply(errorMsg);
    }
  }
}

// Corre recién cuando el staff confirma el panel — vuelve a validar todo desde cero
// (permisos, jerarquía, si el bot todavía puede banearlo) en vez de asumir que las
// condiciones de arriba siguen iguales unos segundos después.
async function confirmBan(interaction, targetUser, motivo) {
  await interaction.update({ content: '⏳ Baneando...', embeds: [], components: [] });

  try {
    if (!(await isStaff(interaction))) {
      await interaction.editReply({ content: '❌ Ya no tenés permisos para esta acción.' });
      return;
    }

    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    const blockReason = getModerationBlockReason(interaction, member);
    if (blockReason) {
      await interaction.editReply({ content: blockReason });
      return;
    }
    if (member && !member.bannable) {
      await interaction.editReply({ content: '❌ Ya no puedo banear a este usuario (puede tener un rol más alto que el mío).' });
      return;
    }

    await interaction.guild.members.ban(targetUser.id, { reason: motivo });
    await interaction.editReply({ content: `✅ Se baneó a ${targetUser.tag}.` });

    // Try/catch propio: el ban ya se aplicó y ya se confirmó — un log fallido no debe
    // mostrarle un error al staff (lo llevaría a reintentar un ban ya aplicado).
    try {
      const logChannel = await getGuildLogChannel(interaction.client, interaction.guildId, 'moderation');
      if (logChannel) {
        await logChannel.send({ embeds: [createBanLogEmbed({ user: targetUser, executor: interaction.user, reason: motivo })] });
      }
    } catch (logError) {
      console.error('⚠️ No se pudo registrar /ban en el canal de logs:', logError);
    }
  } catch (error) {
    console.error('❌ Error al confirmar /ban:', error);
    await interaction.editReply({ content: describeError(error, '❌ Ocurrió un error al banear al usuario.') }).catch(() => {});
  }
}
