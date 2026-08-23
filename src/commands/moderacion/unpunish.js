import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { createPunishLogEmbed } from '../../utils/logEmbeds.js';
import { isStaff, getModerationBlockReason } from '../../utils/permissions.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';
import { getGuildConfig } from '../../utils/guildConfigStore.js';

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
    await interaction.reply({ content: `✅ Se le quitó la restricción a ${targetUser.tag}.` });

    const logChannel = await getGuildLogChannel(interaction.client, interaction.guildId, 'moderation');
    if (logChannel) {
      await logChannel.send({ embeds: [createPunishLogEmbed({ user: targetUser, executor: interaction.user, reason: null, applied: false })] });
    }
  } catch (error) {
    console.error('❌ Error al ejecutar /unpunish:', error);
    const errorMsg = { content: '❌ Ocurrió un error al quitar la restricción.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMsg);
    } else {
      await interaction.reply(errorMsg);
    }
  }
}
