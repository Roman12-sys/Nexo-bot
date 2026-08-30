import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { createPunishLogEmbed } from '../../utils/logEmbeds.js';
import { isStaff, getModerationBlockReason } from '../../utils/permissions.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';
import { getGuildConfig } from '../../utils/guildConfigStore.js';
import { describeError } from '../../utils/errorMessages.js';
import { deleteActivePunishment } from '../../utils/punishStore.js';
import { cancelPunishExpiry } from '../../utils/punishEngine.js';

export const data = new SlashCommandBuilder()
  .setName('unpunish')
  .setDescription('Quita la restricción de imágenes/enlaces a un usuario.')
  .addUserOption((o) => o.setName('usuario').setDescription('Usuario').setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!(await isStaff(interaction))) {
    await interaction.reply({ content: '❌ No tenés permisos para usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  const cfg = await getGuildConfig(interaction.guildId);
  if (!cfg.punish_role_id) {
    await interaction.reply({ content: '⚠️ Este comando no está configurado. Usá `/config rol-castigo` primero.', flags: MessageFlags.Ephemeral });
    return;
  }

  const targetUser = interaction.options.getUser('usuario');

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

    if (!member.roles.cache.has(cfg.punish_role_id)) {
      await interaction.reply({ content: `⚠️ ${targetUser.tag} no tiene la restricción aplicada.`, flags: MessageFlags.Ephemeral });
      return;
    }

    await member.roles.remove(cfg.punish_role_id);

    // QUÉ CAMBIÓ: cancela el timer en memoria + borra la fila de active_punishments si
    // existía (no-op si esta restricción nunca tuvo duración — ambas funciones toleran
    // "no hay nada que cancelar/borrar").
    // MOTIVO: auditoría 2026-08-29 (Diagnóstico Nexo, Parte 22) — sin esto, una
    // restricción quitada a mano ANTES de vencer igual dispararía el timer más tarde e
    // intentaría loguear una "expiración automática" de algo que el staff ya resolvió.
    cancelPunishExpiry(interaction.guildId, targetUser.id);
    await deleteActivePunishment(interaction.guildId, targetUser.id).catch((error) =>
      console.error('⚠️ No se pudo borrar el registro de restricción con duración:', error),
    );

    await interaction.reply({ content: `✅ Se le quitó la restricción a ${targetUser.tag}.` });

    // Try/catch propio: ya se quitó la restricción y ya se confirmó — un log fallido
    // no debe mostrarle un error al staff.
    try {
      const logChannel = await getGuildLogChannel(interaction.client, interaction.guildId, 'moderation');
      if (logChannel) {
        await logChannel.send({ embeds: [createPunishLogEmbed({ user: targetUser, executor: interaction.user, reason: null, applied: false })] });
      }
    } catch (logError) {
      console.error('⚠️ No se pudo registrar /unpunish en el canal de logs:', logError);
    }
  } catch (error) {
    console.error('❌ Error al ejecutar /unpunish:', error);
    const errorMsg = { content: describeError(error, '❌ Ocurrió un error al quitar la restricción.'), flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMsg);
    } else {
      await interaction.reply(errorMsg);
    }
  }
}
