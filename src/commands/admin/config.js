import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, AttachmentBuilder, MessageFlags } from 'discord.js';
import { getGuildConfig, setGuildConfig } from '../../utils/guildConfigStore.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';
import { createBotConfigLogEmbed } from '../../utils/logEmbeds.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';

// Best-effort: /config ya le confirmó el cambio a quien lo hizo — un log fallido acá
// nunca debe aparentar que el cambio en sí no se aplicó.
async function logConfigChange(interaction, changeText) {
  try {
    const logChannel = await getGuildLogChannel(interaction.client, interaction.guildId, 'activity');
    if (logChannel) {
      await logChannel.send({ embeds: [createBotConfigLogEmbed({ executor: interaction.user, changes: [changeText] })] });
    }
  } catch (error) {
    console.error('⚠️ No se pudo registrar un cambio de /config en el canal de logs:', error);
  }
}

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
  .addSubcommand((sub) => sub.setName('exportar').setDescription('Descarga la configuración actual como JSON (respaldo, o para clonarla a otro servidor).'))
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

  // Las 4 confirmaciones de abajo son ephemeral — es configuración del bot en sí, no una
  // acción con consecuencia visible sobre un usuario puntual (a diferencia de /ban, /warn,
  // /punish, etc., que sí son públicas a propósito para dar transparencia). Mismo criterio
  // que ya usa /setup, que trabaja sobre estos mismos campos de guild_config.
  if (sub === 'rol-castigo') {
    const rol = interaction.options.getRole('rol');
    await setGuildConfig(guildId, { punish_role_id: rol?.id ?? null });
    await interaction.reply({ content: rol ? `✅ Rol de castigo configurado: ${rol}.` : '✅ Rol de castigo desactivado.', flags: MessageFlags.Ephemeral });
    await logConfigChange(interaction, rol ? `🚫 Rol de castigo → ${rol}` : '🚫 Rol de castigo desactivado');
    return;
  }

  if (sub === 'rol-automatico') {
    const rol = interaction.options.getRole('rol');
    await setGuildConfig(guildId, { auto_role_id: rol?.id ?? null });
    await interaction.reply({ content: rol ? `✅ Rol automático configurado: ${rol}.` : '✅ Rol automático desactivado.', flags: MessageFlags.Ephemeral });
    await logConfigChange(interaction, rol ? `🎫 Rol automático → ${rol}` : '🎫 Rol automático desactivado');
    return;
  }

  if (sub === 'canal-bienvenida') {
    const canal = interaction.options.getChannel('canal');
    await setGuildConfig(guildId, { welcome_channel_id: canal?.id ?? null });
    await interaction.reply({ content: canal ? `✅ Canal de bienvenida configurado: ${canal}.` : '✅ Canal de bienvenida desactivado.', flags: MessageFlags.Ephemeral });
    await logConfigChange(interaction, canal ? `🎉 Canal de bienvenida → ${canal}` : '🎉 Canal de bienvenida desactivado');
    return;
  }

  if (sub === 'canal-confesiones') {
    const canal = interaction.options.getChannel('canal');
    await setGuildConfig(guildId, { confession_channel_id: canal?.id ?? null });
    await interaction.reply({ content: canal ? `✅ Canal de confesiones configurado: ${canal}.` : '✅ Canal de confesiones desactivado.', flags: MessageFlags.Ephemeral });
    await logConfigChange(interaction, canal ? `🤫 Canal de confesiones → ${canal}` : '🤫 Canal de confesiones desactivado');
    return;
  }

  if (sub === 'ver') {
    await interaction.reply({ embeds: [await buildConfigSummaryEmbed(guildId)], flags: MessageFlags.Ephemeral });
    return;
  }

  if (sub === 'exportar') {
    // guild_id se excluye a propósito: es específico de ESTE server, no tiene sentido
    // llevarlo si esto se usa para clonar la config a otro. Es solo lectura — no pasa
    // por logConfigChange, no cambia nada.
    const { guild_id, ...exportable } = await getGuildConfig(guildId);
    const attachment = new AttachmentBuilder(Buffer.from(JSON.stringify(exportable, null, 2), 'utf-8'), {
      name: `nexo-config-${guildId}.json`,
    });
    await interaction.reply({ content: '📄 Configuración exportada.', files: [attachment], flags: MessageFlags.Ephemeral });
  }
}

const role = (id) => (id ? `<@&${id}>` : '— sin configurar');
const channel = (id) => (id ? `<#${id}>` : '— sin configurar');
const toggle = (on) => (on ? '✅ Activo' : '❌ Apagado');

// Resumen completo de guild_config — no solo los 4 campos sueltos que /config puede
// tocar, también lo que dejó armado /setup (rol de staff, logs, módulos, XP). Así no
// hace falta volver a correr /setup solo para chequear qué quedó prendido.
export async function buildConfigSummaryEmbed(guildId) {
  const cfg = await getGuildConfig(guildId);
  const features = cfg.features || {};
  const levelRolesCount = Object.keys(cfg.level_roles || {}).length;

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('⚙️ Configuración del servidor')
    .addFields(
      { name: '👮 Rol de administrador', value: role(cfg.admin_role_id), inline: true },
      { name: '🛡️ Rol de moderador', value: role(cfg.moderator_role_id), inline: true },
      { name: '​', value: '​', inline: true },
      { name: '📋 Log de moderación', value: channel(cfg.log_channel_moderation_id), inline: true },
      { name: '📋 Log de actividad', value: channel(cfg.log_channel_activity_id), inline: true },
      { name: '📋 Log de economía', value: channel(cfg.log_channel_economy_id), inline: true },
      { name: '🧩 Moderación', value: toggle(features.moderacion), inline: true },
      { name: '🧩 Economía', value: toggle(features.economia), inline: true },
      { name: '🧩 XP', value: toggle(features.xp), inline: true },
      { name: '✨ Roles de nivel', value: levelRolesCount > 0 ? `${levelRolesCount} configurado(s) (modo: ${cfg.level_roles_mode})` : '— sin configurar', inline: true },
      { name: '📣 Anuncio de nivel', value: channel(cfg.xp_announce_channel_id), inline: true },
      { name: '​', value: '​', inline: true },
      { name: '🚫 Rol de castigo', value: role(cfg.punish_role_id), inline: true },
      { name: '🎫 Rol automático', value: role(cfg.auto_role_id), inline: true },
      { name: '🎉 Canal de bienvenida', value: channel(cfg.welcome_channel_id), inline: true },
      { name: '🤫 Canal de confesiones', value: channel(cfg.confession_channel_id), inline: true },
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();

  if (cfg.setup_completed_at) {
    embed.addFields({ name: '🛠️ Última vez que se corrió /setup', value: `<t:${Math.floor(new Date(cfg.setup_completed_at).getTime() / 1000)}:R>` });
  }

  return embed;
}
