import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { createBulkDeleteLogEmbed } from '../../utils/logEmbeds.js';
import { isStaff, isStaffConfigured } from '../../utils/permissions.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';
import { buildConfirmation } from '../../utils/confirmations.js';
import { describeError } from '../../utils/errorMessages.js';

export async function runClear(interaction, cantidad) {
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

  const confirmation = buildConfirmation({
    userId: interaction.user.id,
    guildId: interaction.guildId,
    description: `Vas a eliminar **${cantidad}** mensaje(s) del canal ${channel}.`,
    run: (i) => confirmClear(i, channel, cantidad),
  });
  await interaction.reply({ ...confirmation, flags: MessageFlags.Ephemeral });
}

// Corre recién cuando el staff confirma. Revalida permisos por si cambiaron en la
// ventana de confirmación — el canal y la cantidad no hace falta revalidarlos (no hay
// jerarquía ni "bannable" involucrado, solo permiso de Gestionar mensajes).
async function confirmClear(interaction, channel, cantidad) {
  await interaction.update({ content: '⏳ Eliminando...', embeds: [], components: [] });

  try {
    if (!(await isStaff(interaction))) {
      await interaction.editReply({ content: '❌ Ya no tenés permisos para esta acción.' });
      return;
    }

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
    console.error('❌ Error al confirmar /clear:', error);
    await interaction.editReply({ content: describeError(error, '❌ Ocurrió un error al intentar eliminar los mensajes.') }).catch(() => {});
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
