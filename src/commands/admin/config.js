import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, MessageFlags } from 'discord.js';
import { getGuildConfig, setGuildConfig } from '../../utils/guildConfigStore.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';

// Campos sueltos de guild_config que no tienen creación automática vía /setup — el
// admin elige un rol/canal que YA existe en su servidor, a diferencia de /setup (que
// crea canales/roles nuevos). Cubre lo que en gNoX vivía suelto en .env: PUNISH_ROLE_ID,
// AUTO_ROLE_ID, WELCOME_CHANNEL_ID, CONFESSION_CHANNEL_ID.
export const data = new SlashCommandBuilder()
  .setName('config')
  .setDescription('Configura piezas sueltas del bot (rol de castigo, rol automático, canales especiales).')
  .addSubcommand((sub) =>
    sub
      .setName('rol-castigo')
      .setDescription('Rol que usan /punish y /unpunish para restringir imágenes/enlaces.')
      .addRoleOption((o) => o.setName('rol').setDescription('Rol a usar (dejalo vacío para desactivar)').setRequired(false)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('rol-automatico')
      .setDescription('Rol que se asigna solo a cada miembro nuevo que se une.')
      .addRoleOption((o) => o.setName('rol').setDescription('Rol a asignar (dejalo vacío para desactivar)').setRequired(false)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('canal-bienvenida')
      .setDescription('Canal donde se saluda a los miembros nuevos.')
      .addChannelOption((o) => o.setName('canal').setDescription('Canal de texto (dejalo vacío para desactivar)').addChannelTypes(ChannelType.GuildText).setRequired(false)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('canal-confesiones')
      .setDescription('Canal donde se publican las confesiones anónimas de /confession.')
      .addChannelOption((o) => o.setName('canal').setDescription('Canal de texto (dejalo vacío para desactivar)').addChannelTypes(ChannelType.GuildText).setRequired(false)),
  )
  .addSubcommand((sub) => sub.setName('ver').setDescription('Muestra la configuración actual de estos campos.'))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

export async function execute(interaction) {
  const isOwnerOrAdmin =
    interaction.guild.ownerId === interaction.user.id || interaction.member.permissions.has(PermissionFlagsBits.Administrator);
  if (!isOwnerOrAdmin) {
    await interaction.reply({ content: '❌ Solo el dueño del servidor o un administrador puede usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (sub === 'rol-castigo') {
    const rol = interaction.options.getRole('rol');
    await setGuildConfig(guildId, { punish_role_id: rol?.id ?? null });
    await interaction.reply({ content: rol ? `✅ Rol de castigo configurado: ${rol}.` : '✅ Rol de castigo desactivado.' });
    return;
  }

  if (sub === 'rol-automatico') {
    const rol = interaction.options.getRole('rol');
    await setGuildConfig(guildId, { auto_role_id: rol?.id ?? null });
    await interaction.reply({ content: rol ? `✅ Rol automático configurado: ${rol}.` : '✅ Rol automático desactivado.' });
    return;
  }

  if (sub === 'canal-bienvenida') {
    const canal = interaction.options.getChannel('canal');
    await setGuildConfig(guildId, { welcome_channel_id: canal?.id ?? null });
    await interaction.reply({ content: canal ? `✅ Canal de bienvenida configurado: ${canal}.` : '✅ Canal de bienvenida desactivado.' });
    return;
  }

  if (sub === 'canal-confesiones') {
    const canal = interaction.options.getChannel('canal');
    await setGuildConfig(guildId, { confession_channel_id: canal?.id ?? null });
    await interaction.reply({ content: canal ? `✅ Canal de confesiones configurado: ${canal}.` : '✅ Canal de confesiones desactivado.' });
    return;
  }

  if (sub === 'ver') {
    const cfg = await getGuildConfig(guildId);
    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle('⚙️ Configuración adicional')
      .addFields(
        { name: 'Rol de castigo', value: cfg.punish_role_id ? `<@&${cfg.punish_role_id}>` : '— sin configurar', inline: true },
        { name: 'Rol automático', value: cfg.auto_role_id ? `<@&${cfg.auto_role_id}>` : '— sin configurar', inline: true },
        { name: 'Canal de bienvenida', value: cfg.welcome_channel_id ? `<#${cfg.welcome_channel_id}>` : '— sin configurar', inline: true },
        { name: 'Canal de confesiones', value: cfg.confession_channel_id ? `<#${cfg.confession_channel_id}>` : '— sin configurar', inline: true },
      )
      .setFooter({ text: BRAND_NAME })
      .setTimestamp();
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
}
