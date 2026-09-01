import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { createPunishLogEmbed } from '../../utils/logEmbeds.js';
import { isStaff, getModerationBlockReason } from '../../utils/permissions.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';
import { getGuildConfig } from '../../utils/guildConfigStore.js';
import { describeError } from '../../utils/errorMessages.js';
import { revokePunishment } from '../../utils/punishEngine.js';

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

  // QUÉ CAMBIÓ: deferReply() apenas se sabe que el staff tiene permiso, antes de
  // cualquier otro await (config/fetch de member) — antes el primer reply/deferReply
  // llegaba recién DESPUÉS de la llamada mutante a Discord (member.roles.remove), así
  // que si esos awaits sumaban más de 3s, Discord invalidaba la interacción
  // ("Unknown interaction") aunque la restricción SÍ se hubiera quitado.
  // MOTIVO: auditoría Fase 2B, sección 3 — unpunish.js estaba en la lista explícita de
  // comandos con esta operación lenta antes del ack.
  await interaction.deferReply();

  const targetUser = interaction.options.getUser('usuario');

  try {
    const cfg = await getGuildConfig(interaction.guildId);
    if (!cfg.punish_role_id) {
      await interaction.editReply({ content: '⚠️ Este comando no está configurado. Usá `/config rol-castigo` primero.' });
      return;
    }

    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      await interaction.editReply({ content: '❌ No se encontró a ese usuario en el servidor.' });
      return;
    }

    const blockReason = getModerationBlockReason(interaction, member);
    if (blockReason) {
      await interaction.editReply({ content: blockReason });
      return;
    }

    if (!member.roles.cache.has(cfg.punish_role_id)) {
      await interaction.editReply({ content: `⚠️ ${targetUser.tag} no tiene la restricción aplicada.` });
      return;
    }

    // revokePunishment cancela el timer + borra active_punishments ANTES de tocar
    // Discord — mismo helper central que usa el panel /sanciones (ver punishEngine.js),
    // así los dos caminos quedan garantizados equivalentes en vez de mantener la
    // secuencia duplicada en cada lugar.
    await revokePunishment(interaction.client, { guildId: interaction.guildId, userId: targetUser.id, roleId: cfg.punish_role_id, member });

    await interaction.editReply({ content: `✅ Se le quitó la restricción a ${targetUser.tag}.` });

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
    await interaction.editReply({ content: describeError(error, '❌ Ocurrió un error al quitar la restricción.') }).catch(() => {});
  }
}
