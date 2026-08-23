import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { createLockLogEmbed } from '../../utils/logEmbeds.js';
import { isStaff } from '../../utils/permissions.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';

export const data = new SlashCommandBuilder()
  .setName('lock')
  .setDescription('Bloquea el canal actual para que @everyone no pueda escribir.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!(await isStaff(interaction))) {
    await interaction.reply({ content: '❌ No tenés permisos para usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (!interaction.guild.members.me.permissionsIn(interaction.channel).has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({ content: '❌ Me falta el permiso "Gestionar canales" en este canal para poder bloquearlo.', flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: false });
    await interaction.reply({ content: '🔒 Canal bloqueado.' });

    const logChannel = await getGuildLogChannel(interaction.client, interaction.guildId, 'moderation');
    if (logChannel) {
      await logChannel.send({ embeds: [createLockLogEmbed({ channel: interaction.channel, executor: interaction.user, locked: true })] });
    }
  } catch (error) {
    console.error('❌ Error al ejecutar /lock:', error);
    const errorMsg = { content: '❌ Ocurrió un error al bloquear el canal.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMsg);
    } else {
      await interaction.reply(errorMsg);
    }
  }
}
