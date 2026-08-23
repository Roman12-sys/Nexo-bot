import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { createPunishLogEmbed } from '../../utils/logEmbeds.js';
import { isStaff, getModerationBlockReason } from '../../utils/permissions.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';
import { getGuildConfig } from '../../utils/guildConfigStore.js';

export const data = new SlashCommandBuilder()
  .setName('punish')
  .setDescription('Restringe a un usuario para que no pueda enviar imágenes ni enlaces.')
  .addUserOption((o) => o.setName('usuario').setDescription('Usuario').setRequired(true))
  .addStringOption((o) => o.setName('motivo').setDescription('Motivo').setRequired(false).setMaxLength(512))
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

    if (member.roles.cache.has(cfg.punish_role_id)) {
      await interaction.reply({ content: `⚠️ ${targetUser.tag} ya tiene la restricción aplicada.`, flags: MessageFlags.Ephemeral });
      return;
    }

    const punishRole = interaction.guild.roles.cache.get(cfg.punish_role_id);
    if (!punishRole) {
      await interaction.reply({ content: '⚠️ El rol de restricción configurado ya no existe. Reconfigurálo con `/config rol-castigo`.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (punishRole.position >= interaction.guild.members.me.roles.highest.position) {
      await interaction.reply({ content: '⚠️ No puedo asignar el rol de restricción — está por encima de mi rol más alto.', flags: MessageFlags.Ephemeral });
      return;
    }

    await member.roles.add(cfg.punish_role_id, motivo);
    await interaction.reply({ content: `🚫 ${targetUser.tag} ya no puede enviar imágenes ni enlaces.` });

    // Try/catch propio: la restricción ya se aplicó y ya se confirmó — un log fallido
    // no debe mostrarle un error al staff (lo llevaría a reintentar una ya aplicada).
    try {
      const logChannel = await getGuildLogChannel(interaction.client, interaction.guildId, 'moderation');
      if (logChannel) {
        await logChannel.send({ embeds: [createPunishLogEmbed({ user: targetUser, executor: interaction.user, reason: motivo, applied: true })] });
      }
    } catch (logError) {
      console.error('⚠️ No se pudo registrar /punish en el canal de logs:', logError);
    }
  } catch (error) {
    console.error('❌ Error al ejecutar /punish:', error);
    const errorMsg = { content: '❌ Ocurrió un error al aplicar la restricción.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMsg);
    } else {
      await interaction.reply(errorMsg);
    }
  }
}
