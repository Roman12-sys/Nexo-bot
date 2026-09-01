// Antes, desbanear solo se podía hacer desde el panel /sanciones (abrir → esperar a que
// cargue la lista completa de baneados → buscar). Con muchos baneos, es lento comparado
// con escribir directamente el usuario acá con autocomplete.
import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { isStaff } from '../../utils/permissions.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';
import { createUnbanAutoLogEmbed } from '../../utils/logEmbeds.js';
import { describeError } from '../../utils/errorMessages.js';
import { recordModerationAction } from '../../utils/moderationActionsStore.js';

export const data = new SlashCommandBuilder()
  .setName('unban')
  .setDescription('Desbanea a un usuario.')
  .addStringOption((o) => o.setName('usuario').setDescription('Usuario baneado (escribí para buscar)').setRequired(true).setAutocomplete(true))
  .addStringOption((o) => o.setName('motivo').setDescription('Motivo').setRequired(false).setMaxLength(512))
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .setDMPermission(false);

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const bans = await interaction.guild.bans.fetch().catch(() => new Map());
  const matches = [...bans.values()]
    .filter((ban) => ban.user.tag.toLowerCase().includes(focused) || ban.user.id.includes(focused))
    .slice(0, 25)
    .map((ban) => ({ name: ban.user.tag.slice(0, 100), value: ban.user.id }));

  await interaction.respond(matches);
}

export async function execute(interaction) {
  if (!(await isStaff(interaction))) {
    await interaction.reply({ content: '❌ No tenés permisos para usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Defer apenas se confirma el permiso — antes el primer reply llegaba recién después
  // de users.fetch + members.unban(), lo que arriesgaba "Unknown interaction" si esos
  // awaits sumaban más de 3s aunque el desbaneo SÍ se hubiera aplicado. Ver sección 3 de
  // la auditoría Fase 2B (unban.js estaba en la lista explícita).
  await interaction.deferReply();

  const userId = interaction.options.getString('usuario');
  const motivo = interaction.options.getString('motivo') || 'Sin motivo especificado';

  try {
    const user = await interaction.client.users.fetch(userId).catch(() => null);
    await interaction.guild.members.unban(userId, motivo);
    await interaction.editReply({ content: `✅ Se desbaneó a ${user?.tag || userId}.` });

    // Try/catch propio: el desbaneo ya se aplicó y ya se confirmó — un log fallido no
    // debe mostrarle un error al staff (lo llevaría a reintentar uno ya aplicado).
    try {
      const logChannel = await getGuildLogChannel(interaction.client, interaction.guildId, 'moderation');
      if (logChannel) {
        await logChannel.send({ embeds: [createUnbanAutoLogEmbed({ user, executor: interaction.user, reason: motivo })] });
      }
    } catch (logError) {
      console.error('⚠️ No se pudo registrar /unban en el canal de logs:', logError);
    }

    await recordModerationAction(interaction.guildId, userId, {
      actionType: 'unban',
      moderatorId: interaction.user.id,
      reason: motivo,
    }).catch((e) => console.error('⚠️ No se pudo registrar /unban en el historial de sanciones:', e));
  } catch (error) {
    console.error('❌ Error al ejecutar /unban:', error);
    await interaction.editReply({ content: describeError(error, '❌ Ocurrió un error al desbanear (¿estás seguro de que está baneado?).') }).catch(() => {});
  }
}
