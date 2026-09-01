// Antes, la única forma de corregir el motivo de una advertencia era borrarla con
// /unwarn y volver a aplicarla con /warn — lo que le cambia la fecha original. Esto
// corrige el motivo en el lugar, conservando cuándo se aplicó de verdad.
import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { getUserWarns, updateWarnReasonAt } from '../../utils/warnsStore.js';
import { isStaff, getModerationBlockReason } from '../../utils/permissions.js';
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

  // Defer apenas se confirma el permiso — antes el primer reply llegaba recién después
  // de la escritura en Supabase, sin ningún margen si esa llamada se demoraba. Ver
  // sección 3 de la auditoría Fase 2B (warn-editar estaba en la lista explícita).
  await interaction.deferReply();

  const targetUser = interaction.options.getUser('usuario');
  const numero = interaction.options.getInteger('numero');
  const nuevoMotivo = interaction.options.getString('motivo');

  try {
    // QUÉ CAMBIÓ: mismo chequeo central de jerarquía que /warn y /unwarn — antes
    // warn-editar era el único comando de moderación sin ningún chequeo de jerarquía,
    // así que un moderador podía corregir (no solo borrar) advertencias de alguien con
    // su mismo rango o superior. member puede ser null (el usuario ya no está en el
    // server) — getModerationBlockReason no bloquea en ese caso, mismo criterio que
    // /unwarn: seguir pudiendo corregir advertencias de alguien que ya se fue.
    // MOTIVO: auditoría Fase 2B, sección 1C.
    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    const blockReason = getModerationBlockReason(interaction, member);
    if (blockReason) {
      await interaction.editReply({ content: blockReason });
      return;
    }

    const updated = await updateWarnReasonAt(interaction.guildId, targetUser.id, numero, nuevoMotivo);
    if (!updated) {
      await interaction.editReply({ content: '❌ No se encontró esa advertencia.' });
      return;
    }

    await interaction.editReply({ content: `✅ Se corrigió el motivo de la advertencia #${numero} de ${targetUser}.` });

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
    await interaction.editReply({ content: describeError(error, '❌ Ocurrió un error al editar la advertencia.') }).catch(() => {});
  }
}
