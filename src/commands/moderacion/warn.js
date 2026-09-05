import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { addWarn, getGuildFrequentWarnReasons } from '../../utils/warnsStore.js';
import { createWarnLogEmbed } from '../../utils/logEmbeds.js';
import { isStaff, getModerationBlockReason } from '../../utils/permissions.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';
import { describeError } from '../../utils/errorMessages.js';

export const data = new SlashCommandBuilder()
  .setName('warn')
  .setDescription('Aplica una advertencia a un usuario.')
  .addUserOption((o) => o.setName('usuario').setDescription('Usuario a advertir').setRequired(true))
  .addStringOption((o) => o.setName('motivo').setDescription('Motivo de la advertencia').setRequired(true).setMaxLength(512).setAutocomplete(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setDMPermission(false);

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const reasons = await getGuildFrequentWarnReasons(interaction.guildId).catch(() => []);
  const matches = reasons.filter((r) => r.toLowerCase().includes(focused)).map((r) => ({ name: r.slice(0, 100), value: r.slice(0, 100) }));
  await interaction.respond(matches);
}

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

    // allowedMentions: parse:['users'] permite la mención real de ${targetUser} pero
    // bloquea @everyone/@here/roles que puedan venir inyectados en `motivo` (texto
    // libre de staff, sin sanitizar). Ver SEC-1, Fase 4A.
    await interaction.editReply({
      content: `✅ Se advirtió a ${targetUser} (advertencia #${list.length}). Motivo: ${motivo}`,
      allowedMentions: { parse: ['users'] },
    });

    // Try/catch propio: si el log falla (permisos, rate limit), la advertencia YA se
    // aplicó y el usuario YA vio la confirmación — no hay que mostrarle un error acá,
    // que lo llevaría a reintentar y aplicar una segunda advertencia de más.
    try {
      const logChannel = await getGuildLogChannel(interaction.client, interaction.guildId, 'moderation');
      if (logChannel) {
        await logChannel.send({ embeds: [createWarnLogEmbed({ user: targetUser, executor: interaction.user, reason: motivo, total: list.length })] });
      }
    } catch (logError) {
      console.error('⚠️ No se pudo registrar /warn en el canal de logs:', logError);
    }
  } catch (error) {
    console.error('❌ Error al ejecutar /warn:', error);
    const errorMsg = { content: describeError(error, '❌ Ocurrió un error al aplicar la advertencia.'), flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMsg);
    } else {
      await interaction.reply(errorMsg);
    }
  }
}
