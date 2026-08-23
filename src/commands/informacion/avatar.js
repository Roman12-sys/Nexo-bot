import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';

export async function buildAvatarEmbed(guild, targetUser) {
  const member = await guild.members.fetch(targetUser.id).catch(() => null);
  const avatarUrl = member?.avatarURL({ size: 1024 }) || targetUser.displayAvatarURL({ size: 1024 });

  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`🖼️ Avatar de ${targetUser.tag}`)
    .setImage(avatarUrl)
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();
}

export const data = new SlashCommandBuilder()
  .setName('avatar')
  .setDescription('Muestra el avatar de un usuario en tamaño completo.')
  .addUserOption((option) =>
    option
      .setName('usuario')
      .setDescription('Usuario del que querés ver el avatar (opcional, por defecto vos)')
      .setRequired(false),
  )
  .setDMPermission(false);

export async function execute(interaction) {
  try {
    const targetUser = interaction.options.getUser('usuario') || interaction.user;
    const embed = await buildAvatarEmbed(interaction.guild, targetUser);
    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error('❌ Error al ejecutar /avatar:', error);
    const errorMsg = { content: '❌ Ocurrió un error al obtener el avatar.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMsg);
    } else {
      await interaction.reply(errorMsg);
    }
  }
}
