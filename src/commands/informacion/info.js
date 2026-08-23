import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';

export async function buildInfoEmbed(guild, targetUser) {
  const member = await guild.members.fetch(targetUser.id).catch(() => null);
  if (!member) return null;

  const accountCreated = Math.floor(targetUser.createdTimestamp / 1000);
  const joinedServer = member.joinedTimestamp ? Math.floor(member.joinedTimestamp / 1000) : null;

  const roles = member.roles.cache
    .filter((role) => role.id !== guild.id)
    .sort((a, b) => b.position - a.position)
    .map((role) => `<@&${role.id}>`);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setAuthor({ name: targetUser.tag, iconURL: targetUser.displayAvatarURL() })
    .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: '👤 Usuario', value: `<@${targetUser.id}>`, inline: true },
      { name: '🆔 ID', value: targetUser.id, inline: true },
      { name: '📅 Cuenta creada', value: `<t:${accountCreated}:D>\n(<t:${accountCreated}:R>)`, inline: true },
    );

  if (joinedServer) {
    embed.addFields({
      name: '📥 Se unió al servidor',
      value: `<t:${joinedServer}:D>\n(<t:${joinedServer}:R>)`,
      inline: true,
    });
  }

  embed.addFields({
    name: `🎭 Roles (${roles.length})`,
    value: roles.length > 0 ? roles.slice(0, 15).join(' ') : 'Sin roles asignados',
  });

  embed.setFooter({ text: BRAND_NAME }).setTimestamp();

  return embed;
}

export const data = new SlashCommandBuilder()
  .setName('info')
  .setDescription('Muestra información de tu perfil o el de otro usuario en el servidor.')
  .addUserOption((option) =>
    option
      .setName('usuario')
      .setDescription('Usuario del que querés ver la información (opcional, por defecto vos)')
      .setRequired(false),
  )
  .setDMPermission(false);

export async function execute(interaction) {
  try {
    const targetUser = interaction.options.getUser('usuario') || interaction.user;
    const embed = await buildInfoEmbed(interaction.guild, targetUser);

    if (!embed) {
      await interaction.reply({
        content: '❌ No se pudo encontrar a ese usuario en este servidor.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error('❌ Error al ejecutar /info:', error);
    const errorMsg = { content: '❌ Ocurrió un error al obtener la información del usuario.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMsg);
    } else {
      await interaction.reply(errorMsg);
    }
  }
}
