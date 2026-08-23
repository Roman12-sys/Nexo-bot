import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { getUserWarns } from '../../utils/warnsStore.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import { buildCsvAttachment } from '../../utils/csvExport.js';

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

    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle(`⚠️ Advertencias de ${targetUser.tag}`)
      .setFooter({ text: BRAND_NAME })
      .setTimestamp();

    const description =
      list.length === 0
        ? 'Este usuario no tiene advertencias.'
        : list.map((w, i) => `**#${i + 1}** — ${w.reason}\n<t:${Math.floor(w.timestamp / 1000)}:f> · por <@${w.moderatorId}>`).join('\n\n');

    // Con muchas advertencias (motivos de hasta 512 caracteres) esto puede superar el
    // límite de 4096 de un embed — se corta y se avisa usar `exportar:true` para la
    // lista completa en vez de romper el comando con un error genérico.
    embed.setDescription(
      description.length > 4096
        ? `${description.slice(0, 3950)}...\n\n⚠️ Se cortó la lista — usá \`/warns exportar:true\` para verlas todas.`
        : description,
    );

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('❌ Error al ejecutar /warns:', error);
    await interaction.editReply({ content: '❌ Ocurrió un error al obtener las advertencias.' });
  }
}
