// Antes, la única forma de corregir el motivo de una advertencia era borrarla con
// /unwarn y volver a aplicarla con /warn — lo que le cambia la fecha original. Esto
// corrige el motivo en el lugar, conservando cuándo se aplicó de verdad.
import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { getUserWarns, updateWarnReasonAt } from '../../utils/warnsStore.js';
import { isStaff } from '../../utils/permissions.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';
import { createWarnEditedLogEmbed } from '../../utils/logEmbeds.js';
import { describeError } from '../../utils/errorMessages.js';

export const data = new SlashCommandBuilder()
  .setName('warn-editar')
  .setDescription('Corrige el motivo de una advertencia ya aplicada, sin perder la fecha original.')
  .addUserOption((o) => o.setName('usuario').setDescription('Usuario').setRequired(true))
  .addIntegerOption((o) => o.setName('numero').setDescription('Número de advertencia a editar (elegí de la lista)').setRequired(true).setMinValue(1).setAutocomplete(true))
  .addStringOption((o) => o.setName('motivo').setDescription('Motivo corregido').setRequired(true).setMaxLength(512))
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setDMPermission(false);

export async function autocomplete(interaction) {
  const targetUser = interaction.options.getUser('usuario');
  if (!targetUser) return interaction.respond([]);

  const warns = await getUserWarns(interaction.guildId, targetUser.id).catch(() => []);
  const choices = warns.map((w, i) => ({ name: `#${i + 1} — ${w.reason}`.slice(0, 100), value: i + 1 }));
  await interaction.respond(choices.slice(0, 25));
}

export async function execute(interaction) {
  if (!(await isStaff(interaction))) {
    await interaction.reply({ content: '❌ No tenés permisos para usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  const targetUser = interaction.options.getUser('usuario');
  const numero = interaction.options.getInteger('numero');
  const nuevoMotivo = interaction.options.getString('motivo');

  try {
    const updated = await updateWarnReasonAt(interaction.guildId, targetUser.id, numero, nuevoMotivo);
    if (!updated) {
      await interaction.reply({ content: '❌ No se encontró esa advertencia.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.reply({ content: `✅ Se corrigió el motivo de la advertencia #${numero} de ${targetUser}.` });

    try {
      const logChannel = await getGuildLogChannel(interaction.client, interaction.guildId, 'moderation');
      if (logChannel) {
        await logChannel.send({
          embeds: [createWarnEditedLogEmbed({ user: targetUser, executor: interaction.user, numero, motivoNuevo: nuevoMotivo })],
        });
      }
    } catch (logError) {
      console.error('⚠️ No se pudo registrar /warn-editar en el canal de logs:', logError);
    }
  } catch (error) {
    console.error('❌ Error al ejecutar /warn-editar:', error);
    const errorMsg = { content: describeError(error, '❌ Ocurrió un error al editar la advertencia.'), flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMsg);
    } else {
      await interaction.reply(errorMsg);
    }
  }
}
