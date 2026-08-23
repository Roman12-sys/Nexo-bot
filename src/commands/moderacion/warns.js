import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { getUserWarns } from '../../utils/warnsStore.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import { buildCsvAttachment } from '../../utils/csvExport.js';
import { registerButtonPrefix } from '../../components/buttons.js';
import { describeError } from '../../utils/errorMessages.js';

const PAGE_SIZE = 5; // motivos de hasta 512 caracteres — 5 por página se queda cómodo bajo el límite de 4096 del embed

function buildWarnsEmbed(targetUser, list, page) {
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const clampedPage = Math.min(Math.max(0, page), totalPages - 1);
  const slice = list.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`⚠️ Advertencias de ${targetUser.tag}`)
    .setFooter({ text: `${BRAND_NAME} • Página ${clampedPage + 1}/${totalPages} • ${list.length} advertencia(s)` })
    .setTimestamp();

  embed.setDescription(
    list.length === 0
      ? 'Este usuario no tiene advertencias.'
      : slice
          .map((w, i) => `**#${clampedPage * PAGE_SIZE + i + 1}** — ${w.reason}\n<t:${Math.floor(w.timestamp / 1000)}:f> · por <@${w.moderatorId}>`)
          .join('\n\n'),
  );

  return { embed, clampedPage, totalPages };
}

function buildWarnsRow(targetUserId, clampedPage, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`warns_page_${clampedPage - 1}_${targetUserId}`)
      .setLabel('◀️ Anterior')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clampedPage <= 0),
    new ButtonBuilder()
      .setCustomId(`warns_page_${clampedPage + 1}_${targetUserId}`)
      .setLabel('Siguiente ▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clampedPage >= totalPages - 1),
  );
}

export const data = new SlashCommandBuilder()
  .setName('warns')
  .setDescription('Muestra las advertencias de un usuario.')
  .addUserOption((o) => o.setName('usuario').setDescription('Usuario').setRequired(true))
  .addBooleanOption((o) => o.setName('exportar').setDescription('Adjuntar las advertencias como CSV en vez de mostrarlas').setRequired(false))
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!(await isStaff(interaction))) {
    await interaction.reply({ content: '❌ No tenés permisos para usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const targetUser = interaction.options.getUser('usuario');
    const exportar = interaction.options.getBoolean('exportar') || false;
    const list = await getUserWarns(interaction.guild.id, targetUser.id);

    if (exportar) {
      if (list.length === 0) {
        await interaction.editReply({ content: 'Este usuario no tiene advertencias.' });
        return;
      }
      const attachment = buildCsvAttachment(
        `warns-${targetUser.id}.csv`,
        [
          { key: 'numero', header: '#' },
          { key: 'fecha', header: 'Fecha' },
          { key: 'moderador', header: 'Moderador' },
          { key: 'motivo', header: 'Motivo' },
        ],
        list.map((w, i) => ({
          numero: i + 1,
          fecha: new Date(w.timestamp).toISOString(),
          moderador: w.moderatorId,
          motivo: w.reason,
        })),
      );
      await interaction.editReply({ content: `📄 Advertencias de ${targetUser.tag} (${list.length}).`, files: [attachment] });
      return;
    }

    const { embed, clampedPage, totalPages } = buildWarnsEmbed(targetUser, list, 0);
    const components = list.length > PAGE_SIZE ? [buildWarnsRow(targetUser.id, clampedPage, totalPages)] : [];
    await interaction.editReply({ embeds: [embed], components });
  } catch (error) {
    console.error('❌ Error al ejecutar /warns:', error);
    await interaction.editReply({ content: describeError(error, '❌ Ocurrió un error al obtener las advertencias.') });
  }
}

registerButtonPrefix('warns_page_', async (interaction) => {
  if (!(await isStaff(interaction))) return interaction.reply({ content: '❌ No tenés permisos.', flags: MessageFlags.Ephemeral });

  const [pageRaw, targetUserId] = interaction.customId.slice('warns_page_'.length).split('_');
  const targetUser = await interaction.client.users.fetch(targetUserId).catch(() => null);
  if (!targetUser) return interaction.reply({ content: '❌ No se pudo encontrar a ese usuario.', flags: MessageFlags.Ephemeral });

  const list = await getUserWarns(interaction.guild.id, targetUserId);
  const { embed, clampedPage, totalPages } = buildWarnsEmbed(targetUser, list, parseInt(pageRaw, 10));
  await interaction.update({ embeds: [embed], components: [buildWarnsRow(targetUserId, clampedPage, totalPages)] });
});
