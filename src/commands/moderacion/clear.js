import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { createBulkDeleteLogEmbed } from '../../utils/logEmbeds.js';
import { isStaff, isStaffConfigured } from '../../utils/permissions.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';

async function runClear(interaction, cantidad) {
  if (!(await isStaffConfigured(interaction.guildId))) {
    await interaction.reply({
      content: '⚠️ Este servidor todavía no configuró un rol de staff. Corré /setup primero.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!(await isStaff(interaction))) {
    await interaction.reply({ content: '❌ No tenés permisos para usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  const channel = interaction.channel;
  if (!channel || typeof channel.bulkDelete !== 'function') {
    await interaction.reply({
      content: '❌ Este comando solo puede usarse en canales de texto de un servidor.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const deleted = await channel.bulkDelete(cantidad, true);
    const omitidos = cantidad - deleted.size;

    let respuesta = `✅ Se eliminaron **${deleted.size}** mensaje(s).`;
    if (omitidos > 0) {
      respuesta += `\n⚠️ ${omitidos} mensaje(s) no se pudieron eliminar (probablemente tienen más de 14 días, límite de la API de Discord).`;
    }

    await interaction.editReply({ content: respuesta });

    try {
      const logChannel = await getGuildLogChannel(interaction.client, interaction.guildId, 'moderation');
      if (logChannel) {
        const embed = createBulkDeleteLogEmbed({
          cantidad: deleted.size,
          channel,
          executor: interaction.user,
          viaComando: true,
        });
        await logChannel.send({ embeds: [embed] });
      }
    } catch (logError) {
      console.error('⚠️ No se pudo registrar el uso de /clear en el canal de logs:', logError);
    }
  } catch (error) {
    console.error('❌ Error al ejecutar /clear:', error);
    const errorMsg = { content: '❌ Ocurrió un error al intentar eliminar los mensajes.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred) {
      await interaction.editReply(errorMsg);
    } else {
      await interaction.reply(errorMsg);
    }
  }
}

export const data = new SlashCommandBuilder()
  .setName('clear')
  .setDescription('Elimina una cantidad de mensajes del canal actual.')
  .addIntegerOption((option) =>
    option
      .setName('cantidad')
      .setDescription('Cantidad de mensajes a eliminar (1-100)')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(100),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .setDMPermission(false);

export async function execute(interaction) {
  const cantidad = interaction.options.getInteger('cantidad');
  await runClear(interaction, cantidad);
}
