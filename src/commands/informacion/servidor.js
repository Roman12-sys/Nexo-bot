import { SlashCommandBuilder, EmbedBuilder, ChannelType, MessageFlags } from 'discord.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';

export function buildServerEmbed(guild) {
  const createdTimestamp = Math.floor(guild.createdTimestamp / 1000);
  const textChannels = guild.channels.cache.filter((c) => c.type === ChannelType.GuildText).size;
  const voiceChannels = guild.channels.cache.filter((c) => c.type === ChannelType.GuildVoice).size;

  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`📊 ${guild.name}`)
    .setThumbnail(guild.iconURL({ size: 256 }))
    .addFields(
      { name: '📅 Creado el', value: `<t:${createdTimestamp}:D>\n(<t:${createdTimestamp}:R>)`, inline: true },
      { name: '👥 Miembros', value: `${guild.memberCount.toLocaleString('es-ES')}`, inline: true },
      { name: '🚀 Nivel de boost', value: `Nivel ${guild.premiumTier} (${guild.premiumSubscriptionCount || 0} boosts)`, inline: true },
      { name: '💬 Canales de texto', value: `${textChannels}`, inline: true },
      { name: '🔊 Canales de voz', value: `${voiceChannels}`, inline: true },
      { name: '🎭 Roles', value: `${guild.roles.cache.size}`, inline: true },
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();
}

export const data = new SlashCommandBuilder()
  .setName('servidor')
  .setDescription('Muestra información general sobre este servidor.')
  .setDMPermission(false);

export async function execute(interaction) {
  try {
    const embed = buildServerEmbed(interaction.guild);
    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error('❌ Error al ejecutar /servidor:', error);
    const errorMsg = { content: '❌ Ocurrió un error al obtener la información del servidor.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMsg);
    } else {
      await interaction.reply(errorMsg);
    }
  }
}
