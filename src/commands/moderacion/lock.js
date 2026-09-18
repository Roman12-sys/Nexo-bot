import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { createLockLogEmbed } from '../../utils/logEmbeds.js';
import { isStaff } from '../../utils/permissions.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';
import { describeError } from '../../utils/errorMessages.js';
import { INDIGO_COLOR, BRAND_NAME } from '../../utils/embeds.js';

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

  // Defer apenas pasan los chequeos sync — antes el primer reply llegaba recién después
  // de permissionOverwrites.edit(), lo que arriesgaba "Unknown interaction" si ese await
  // se demoraba más de 3s aunque el canal SÍ se hubiera bloqueado. Ver sección 3 de la
  // auditoría Fase 2B (lock.js estaba en la lista explícita).
  await interaction.deferReply();

  try {
    await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: false });
    const embed = new EmbedBuilder()
      .setColor(INDIGO_COLOR)
      .setTitle('🔒 Canal bloqueado')
      .setDescription(`${interaction.channel} ya no acepta mensajes de @everyone.`)
      .setFooter({ text: BRAND_NAME })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });

    // Try/catch propio: el canal ya se bloqueó y ya se confirmó — un log fallido no
    // debe mostrarle un error al staff.
    try {
      const logChannel = await getGuildLogChannel(interaction.client, interaction.guildId, 'moderation');
      if (logChannel) {
        await logChannel.send({ embeds: [createLockLogEmbed({ channel: interaction.channel, executor: interaction.user, locked: true })] });
      }
    } catch (logError) {
      console.error('⚠️ No se pudo registrar /lock en el canal de logs:', logError);
    }
  } catch (error) {
    console.error('❌ Error al ejecutar /lock:', error);
    await interaction.editReply({ content: describeError(error, '❌ Ocurrió un error al bloquear el canal.') }).catch(() => {});
  }
}
