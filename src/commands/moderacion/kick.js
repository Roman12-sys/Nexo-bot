import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { createKickLogEmbed } from '../../utils/logEmbeds.js';
import { isStaff, getModerationBlockReason } from '../../utils/permissions.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';
import { buildConfirmation } from '../../utils/confirmations.js';
import { describeError } from '../../utils/errorMessages.js';
import { recordModerationAction, getGuildFrequentReasons } from '../../utils/moderationActionsStore.js';
import { INDIGO_COLOR, BRAND_NAME } from '../../utils/embeds.js';

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

// Auditoría UX/UI (2026-09-18), hallazgo Importante del Top 20: /kick era el único
// comando de remoción/expulsión sin panel de confirmación, sin ningún criterio
// documentado de por qué quedaba afuera del set que sí lo tiene (/ban /clear /unwarn) —
// mismo riesgo de un kick accidental sin red de seguridad. Mismo patrón EXACTO que
// ban.js: fetch+validación antes de responder, `buildConfirmation` arma el panel,
// confirmKick() revalida todo desde cero (nunca asume que las condiciones siguen
// iguales unos segundos después) — incluida la única validación exclusiva de kick que
// ban.js no necesita: el usuario puede haberse ido del server en la ventana de espera.
export async function execute(interaction) {
  if (!(await isStaff(interaction))) {
    await interaction.reply({ content: '❌ No tenés permisos para usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  const targetUser = interaction.options.getUser('usuario');
  const motivo = interaction.options.getString('motivo') || 'Sin motivo especificado';

  try {
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

    const confirmation = buildConfirmation({
      userId: interaction.user.id,
      guildId: interaction.guildId,
      description: `Vas a expulsar a **${targetUser.tag}**.\nMotivo: ${motivo}`,
      run: (i) => confirmKick(i, targetUser, motivo),
    });
    await interaction.reply(confirmation);
  } catch (error) {
    console.error('❌ Error al ejecutar /kick:', error);
    const errorMsg = { content: describeError(error, '❌ Ocurrió un error al expulsar al usuario.'), flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMsg);
    } else {
      await interaction.reply(errorMsg);
    }
  }
}

// Corre recién cuando el staff confirma el panel — vuelve a validar todo desde cero
// (permisos, jerarquía, si el bot todavía puede expulsarlo, si el usuario sigue en el
// server) en vez de asumir que las condiciones de arriba siguen iguales unos segundos
// después.
async function confirmKick(interaction, targetUser, motivo) {
  await interaction.update({ content: '⏳ Expulsando...', embeds: [], components: [] });

  try {
    if (!(await isStaff(interaction))) {
      await interaction.editReply({ content: '❌ Ya no tenés permisos para esta acción.' });
      return;
    }

    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      await interaction.editReply({ content: '❌ Ese usuario ya no está en el servidor.' });
      return;
    }

    const blockReason = getModerationBlockReason(interaction, member);
    if (blockReason) {
      await interaction.editReply({ content: blockReason });
      return;
    }

    if (!member.kickable) {
      await interaction.editReply({ content: '❌ Ya no puedo expulsar a este usuario (puede tener un rol más alto que el mío).' });
      return;
    }

    await member.kick(motivo);
    // Auditoría UX/UI (2026-09-18), hallazgo Crítico "Moderación sin embeds propios":
    // esqueleto estándar (INDIGO_COLOR, mismo criterio que /daily /work /rob /give).
    const embed = new EmbedBuilder()
      .setColor(INDIGO_COLOR)
      .setTitle('👢 Usuario expulsado')
      .setDescription(`Se expulsó a **${targetUser.tag}**.`)
      .setFooter({ text: BRAND_NAME })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });

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
    console.error('❌ Error al confirmar /kick:', error);
    await interaction.editReply({ content: describeError(error, '❌ Ocurrió un error al expulsar al usuario.') }).catch(() => {});
  }
}
