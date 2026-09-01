import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { createTimeoutLogEmbed } from '../../utils/logEmbeds.js';
import { isStaff, getModerationBlockReason } from '../../utils/permissions.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';
import { describeError } from '../../utils/errorMessages.js';
import { recordModerationAction, getGuildFrequentReasons } from '../../utils/moderationActionsStore.js';

export const data = new SlashCommandBuilder()
  .setName('timeout')
  .setDescription('Silencia temporalmente a un usuario.')
  .addUserOption((o) => o.setName('usuario').setDescription('Usuario').setRequired(true))
  .addStringOption((o) =>
    o.setName('duracion').setDescription('Duración').setRequired(true).addChoices(
      { name: '60 segundos', value: '60000' },
      { name: '5 minutos', value: '300000' },
      { name: '10 minutos', value: '600000' },
      { name: '1 hora', value: '3600000' },
      { name: '1 día', value: '86400000' },
      { name: '1 semana', value: '604800000' },
    ),
  )
  .addStringOption((o) => o.setName('motivo').setDescription('Motivo').setRequired(false).setMaxLength(512).setAutocomplete(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setDMPermission(false);

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const reasons = await getGuildFrequentReasons(interaction.guildId, 'timeout').catch(() => []);
  const matches = reasons.filter((r) => r.toLowerCase().includes(focused)).map((r) => ({ name: r.slice(0, 100), value: r.slice(0, 100) }));
  await interaction.respond(matches);
}

export async function execute(interaction) {
  if (!(await isStaff(interaction))) {
    await interaction.reply({ content: '❌ No tenés permisos para usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Defer apenas se confirma el permiso — antes el primer reply llegaba recién después
  // de members.fetch + member.timeout(), lo que arriesgaba "Unknown interaction" si esos
  // awaits sumaban más de 3s aunque el timeout SÍ se hubiera aplicado. Ver sección 3 de
  // la auditoría Fase 2B (timeout.js estaba en la lista explícita).
  await interaction.deferReply();

  const targetUser = interaction.options.getUser('usuario');
  const duracionMs = parseInt(interaction.options.getString('duracion'), 10);
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

    if (!member.moderatable) {
      await interaction.editReply({ content: '❌ No puedo aplicar timeout a este usuario.' });
      return;
    }

    await member.timeout(duracionMs, motivo);
    const until = Date.now() + duracionMs;

    await interaction.editReply({ content: `✅ Se silenció a ${targetUser.tag} hasta <t:${Math.floor(until / 1000)}:f>.` });

    // Try/catch propio: el timeout ya se aplicó y ya se confirmó — un log fallido no
    // debe mostrarle un error al staff (lo llevaría a reintentar uno ya aplicado).
    try {
      const logChannel = await getGuildLogChannel(interaction.client, interaction.guildId, 'moderation');
      if (logChannel) {
        await logChannel.send({ embeds: [createTimeoutLogEmbed({ user: targetUser, executor: interaction.user, reason: motivo, until, removed: false })] });
      }
    } catch (logError) {
      console.error('⚠️ No se pudo registrar /timeout en el canal de logs:', logError);
    }

    await recordModerationAction(interaction.guildId, targetUser.id, {
      actionType: 'timeout',
      moderatorId: interaction.user.id,
      reason: motivo,
      extra: { until },
    }).catch((e) => console.error('⚠️ No se pudo registrar /timeout en el historial de sanciones:', e));
  } catch (error) {
    console.error('❌ Error al ejecutar /timeout:', error);
    await interaction.editReply({ content: describeError(error, '❌ Ocurrió un error al aplicar el timeout.') }).catch(() => {});
  }
}
