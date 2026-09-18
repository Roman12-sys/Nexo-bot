import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } from 'discord.js';
import { isAdmin } from '../../utils/permissions.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';
import { INDIGO_COLOR } from '../../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('say')
  .setDescription('El bot repite tu mensaje.')
  .addStringOption((o) => o.setName('mensaje').setDescription('Qué querés que diga el bot').setRequired(true).setMaxLength(2000))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false);

// H4, auditoría completa NEXO — cualquier Tier 1 (moderador) podía pingear @everyone
// con texto libre sin ninguna fricción extra. Se sube a Tier 2 (isAdmin, exclusivo de
// admin_role_id) — mismo criterio que /economia-staff y /xp: herramientas de alto
// impacto potencial (acá, hablar como el bot al servidor entero) quedan en el tier de
// más confianza, no en el de moderación del día a día.
export async function execute(interaction) {
  // Auditoría UX/UI (2026-09-18), hallazgo Importante del Top 20: el mensaje viejo
  // ("No tenés permisos...") sugería un permiso nativo de Discord — el gate real es un
  // ROL de NEXO (/config rol-admin), sin relación con "Gestionar servidor".
  if (!(await isAdmin(interaction))) {
    await interaction.reply({
      content: '❌ Este comando requiere el rol de Administrador configurado con `/config rol-admin` — no es un permiso nativo de Discord, un Moderador no puede usarlo.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const mensaje = interaction.options.getString('mensaje');
  const allowedMentions = { parse: ['everyone', 'roles', 'users'] };

  try {
    // Mandamos el mensaje primero: si falla (falta de permisos en el canal, etc.),
    // no queremos haberle confirmado "✅ Enviado" al usuario de antemano.
    await interaction.channel.send({ content: mensaje, allowedMentions });
    await interaction.reply({ content: '✅ Enviado.', flags: MessageFlags.Ephemeral });
  } catch (error) {
    console.error('❌ Error al ejecutar /say:', error);
    await interaction.reply({ content: '❌ No se pudo enviar el mensaje en este canal.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Guardamos un registro de quién usó /say y qué dijo, para poder rastrearlo si hace falta
  try {
    const logChannel = await getGuildLogChannel(interaction.client, interaction.guildId, 'moderation');
    if (logChannel) {
      const embed = new EmbedBuilder()
        .setColor(INDIGO_COLOR)
        .setTitle('🗣️ /say utilizado')
        .addFields(
          { name: 'Usuario', value: `${interaction.user.tag} (\`${interaction.user.id}\`)`, inline: true },
          { name: 'Canal', value: `<#${interaction.channel.id}>`, inline: true },
          { name: 'Mensaje', value: mensaje.length > 1024 ? `${mensaje.slice(0, 1021)}...` : mensaje },
        )
        .setTimestamp();
      await logChannel.send({ embeds: [embed] });
    }
  } catch (logError) {
    console.error('⚠️ No se pudo registrar el uso de /say en el canal de logs:', logError);
  }
}
