import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { createKickLogEmbed } from '../../utils/logEmbeds.js';
import { isStaff, getModerationBlockReason } from '../../utils/permissions.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';
import { describeError } from '../../utils/errorMessages.js';
import { recordModerationAction, getGuildFrequentReasons } from '../../utils/moderationActionsStore.js';

export const data = new SlashCommandBuilder()
  .setName('kick')
  .setDescription('Expulsa a un usuario del servidor.')
  .addUserOption((o) => o.setName('usuario').setDescription('Usuario a expulsar').setRequired(true))
  .addStringOption((o) => o.setName('motivo').setDescription('Motivo').setRequired(false).setMaxLength(512).setAutocomplete(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
  .setDMPermission(false);

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const reasons = await getGuildFrequentReasons(interaction.guildId, 'kick').catch(() => []);
  const matches = reasons.filter((r) => r.toLowerCase().includes(focused)).map((r) => ({ name: r.slice(0, 100), value: r.slice(0, 100) }));
  await interaction.respond(matches);
}

export async function execute(interaction) {
  if (!(await isStaff(interaction))) {
    await interaction.reply({ content: '❌ No tenés permisos para usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Defer apenas se confirma el permiso — antes el primer reply llegaba recién después
  // de members.fetch + member.kick(), lo que arriesgaba "Unknown interaction" si esos
  // awaits sumaban más de 3s aunque el kick SÍ se hubiera aplicado. Ver sección 3 de la
  // auditoría Fase 2B (kick.js estaba en la lista explícita).
  await interaction.deferReply();

  const targetUser = interaction.options.getUser('usuario');
  const motivo = interaction.options.getString('motivo') || 'Sin motivo especificado';

  try {
    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      await interaction.editReply({ content: '❌ No se encontró a ese usuario en el servidor.' });
      return;
    }

    const blockReason = getModerationBlockReason(interaction, member);
    if (blockReason) {
      await interaction.editReply({ content: blockReason });
      return;
    }

    if (!member.kickable) {
      await interaction.editReply({ content: '❌ No puedo expulsar a este usuario (puede tener un rol más alto que el mío).' });
      return;
    }

    await member.kick(motivo);
    await interaction.editReply({ content: `✅ Se expulsó a ${targetUser.tag}.` });

    // Try/catch propio: el kick ya se aplicó y ya se confirmó — un log fallido no debe
    // mostrarle un error al staff (lo llevaría a reintentar un kick ya aplicado).
    try {
      const logChannel = await getGuildLogChannel(interaction.client, interaction.guildId, 'moderation');
      if (logChannel) {
        await logChannel.send({ embeds: [createKickLogEmbed({ user: targetUser, executor: interaction.user, reason: motivo })] });
      }
    } catch (logError) {
      console.error('⚠️ No se pudo registrar /kick en el canal de logs:', logError);
    }

    await recordModerationAction(interaction.guildId, targetUser.id, {
      actionType: 'kick',
      moderatorId: interaction.user.id,
      reason: motivo,
    }).catch((e) => console.error('⚠️ No se pudo registrar /kick en el historial de sanciones:', e));
  } catch (error) {
    console.error('❌ Error al ejecutar /kick:', error);
    await interaction.editReply({ content: describeError(error, '❌ Ocurrió un error al expulsar al usuario.') }).catch(() => {});
  }
}
