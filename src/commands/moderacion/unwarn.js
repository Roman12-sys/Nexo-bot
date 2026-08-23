import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { removeWarnAt, clearWarns, getUserWarns } from '../../utils/warnsStore.js';
import { createUnwarnLogEmbed } from '../../utils/logEmbeds.js';
import { isStaff, getModerationBlockReason } from '../../utils/permissions.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';
import { buildConfirmation } from '../../utils/confirmations.js';
import { describeError } from '../../utils/errorMessages.js';

export const data = new SlashCommandBuilder()
  .setName('unwarn')
  .setDescription('Quita una advertencia de un usuario.')
  .addUserOption((o) => o.setName('usuario').setDescription('Usuario').setRequired(true))
  .addIntegerOption((o) =>
    o
      .setName('numero')
      .setDescription('Número de advertencia a quitar (elegí de la lista). Si se omite, se borran todas.')
      .setRequired(false)
      .setMinValue(1)
      .setAutocomplete(true),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setDMPermission(false);

// Solo tiene sentido sugerir algo si ya se eligió a quién — sin "usuario" todavía no hay
// de dónde sacar advertencias para listar.
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

  try {
    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    const blockReason = getModerationBlockReason(interaction, member);
    if (blockReason) {
      await interaction.reply({ content: blockReason, flags: MessageFlags.Ephemeral });
      return;
    }

    let description;
    if (numero) {
      const warns = await getUserWarns(interaction.guild.id, targetUser.id);
      const target = warns[numero - 1];
      if (!target) {
        await interaction.reply({ content: '❌ No se encontró esa advertencia.', flags: MessageFlags.Ephemeral });
        return;
      }
      description = `Vas a quitar la advertencia **#${numero}** de ${targetUser}.\nMotivo: ${target.reason}`;
    } else {
      description = `Vas a borrar **todas** las advertencias de ${targetUser}.`;
    }

    const confirmation = buildConfirmation({
      userId: interaction.user.id,
      guildId: interaction.guildId,
      description,
      run: (i) => confirmUnwarn(i, targetUser, numero),
    });
    await interaction.reply(confirmation);
  } catch (error) {
    console.error('❌ Error al ejecutar /unwarn:', error);
    const errorMsg = { content: describeError(error, '❌ Ocurrió un error al quitar la(s) advertencia(s).'), flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMsg);
    } else {
      await interaction.reply(errorMsg);
    }
  }
}

// Corre recién cuando el staff confirma. Revalida permisos y jerarquía por si
// cambiaron en la ventana de confirmación.
async function confirmUnwarn(interaction, targetUser, numero) {
  await interaction.update({ content: '⏳ Procesando...', embeds: [], components: [] });

  try {
    if (!(await isStaff(interaction))) {
      await interaction.editReply({ content: '❌ Ya no tenés permisos para esta acción.' });
      return;
    }

    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    const blockReason = getModerationBlockReason(interaction, member);
    if (blockReason) {
      await interaction.editReply({ content: blockReason });
      return;
    }

    const logChannel = await getGuildLogChannel(interaction.client, interaction.guildId, 'moderation');

    if (numero) {
      const removed = await removeWarnAt(interaction.guild.id, targetUser.id, numero);
      if (!removed) {
        await interaction.editReply({ content: '❌ Esa advertencia ya no existe (puede que se haya quitado desde otro lado).' });
        return;
      }
      await interaction.editReply({ content: `✅ Se quitó la advertencia #${numero} de ${targetUser}.` });

      if (logChannel) {
        await logChannel.send({ embeds: [createUnwarnLogEmbed({ user: targetUser, executor: interaction.user, detail: `Advertencia #${numero} (${removed.reason})` })] });
      }
    } else {
      const total = await clearWarns(interaction.guild.id, targetUser.id);
      await interaction.editReply({ content: `✅ Se borraron las ${total} advertencia(s) de ${targetUser}.` });

      if (total > 0 && logChannel) {
        await logChannel.send({ embeds: [createUnwarnLogEmbed({ user: targetUser, executor: interaction.user, detail: `Se borraron todas (${total})` })] });
      }
    }
  } catch (error) {
    console.error('❌ Error al confirmar /unwarn:', error);
    await interaction.editReply({ content: describeError(error, '❌ Ocurrió un error al quitar la(s) advertencia(s).') }).catch(() => {});
  }
}
