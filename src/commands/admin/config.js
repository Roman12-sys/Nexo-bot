import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, AttachmentBuilder, MessageFlags } from 'discord.js';
import { getGuildConfig, setGuildConfig } from '../../utils/guildConfigStore.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';
import { getDangerousRolePermission } from '../../utils/permissions.js';
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
  .addSubcommand((sub) =>
    sub
      .setName('canal-anuncio-nivel')
      .setDescription('Canal donde se anuncia cuando alguien sube de nivel.')
      .addChannelOption((o) => o.setName('canal').setDescription('Canal de texto (dejalo vacío para desactivar)').addChannelTypes(ChannelType.GuildText).setRequired(false)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('rol-nivel')
      .setDescription('Asigna (o quita) el rol que se entrega automáticamente al llegar a un nivel.')
      .addIntegerOption((o) => o.setName('nivel').setDescription('Nivel exacto').setRequired(true).setMinValue(1))
      .addRoleOption((o) => o.setName('rol').setDescription('Rol a entregar (dejalo vacío para quitar el rol de ese nivel)').setRequired(false)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('modo-roles-nivel')
      .setDescription('Cómo se acumulan los roles de nivel al subir varios de una vez.')
      .addStringOption((o) =>
        o
          .setName('modo')
          .setDescription('Acumulativo: te quedás con todos. Reemplazar: solo el del nivel más alto.')
          .setRequired(true)
          .addChoices({ name: 'Acumulativo (te quedás con todos)', value: 'cumulative' }, { name: 'Reemplazar (solo el más alto)', value: 'replace' }),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('confesiones-revision')
      .setDescription('Si está activo, las confesiones pasan por aprobación del staff antes de publicarse.')
      .addBooleanOption((o) => o.setName('activo').setDescription('Activar o desactivar la revisión previa').setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('confesion-bloquear')
      .setDescription('Impide que un usuario puntual use /confession en este servidor.')
      .addUserOption((o) => o.setName('usuario').setDescription('Usuario a bloquear').setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('confesion-desbloquear')
      .setDescription('Le devuelve a un usuario el acceso a /confession.')
      .addUserOption((o) => o.setName('usuario').setDescription('Usuario a desbloquear').setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('xp-finde-boost')
      .setDescription('Si está activo, sábado y domingo se gana el doble de XP por mensaje y por voz.')
      .addBooleanOption((o) => o.setName('activo').setDescription('Activar o desactivar el impulso de finde').setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('xp-canal-ignorar')
      .setDescription('Ese canal deja de dar XP por mensajes (ej. un canal de bots o de spam).')
      .addChannelOption((o) => o.setName('canal').setDescription('Canal a ignorar').setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('xp-canal-permitir')
      .setDescription('Ese canal vuelve a dar XP por mensajes normalmente.')
      .addChannelOption((o) => o.setName('canal').setDescription('Canal a permitir de nuevo').setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('canal-lol')
      .setDescription('Canal donde se avisan los patch notes de League of Legends (opcional, apagado por defecto).')
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
    if (rol) {
      const dangerousPermission = getDangerousRolePermission(rol);
      if (dangerousPermission) {
        await interaction.reply({
          content: `❌ ${rol} tiene el permiso **${dangerousPermission}**, así que no se puede usar como rol de castigo — el bot se lo agregaría a cualquier usuario sancionado, entregándole ese permiso por error. Elegí (o creá) un rol sin privilegios administrativos.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }
    await setGuildConfig(guildId, { punish_role_id: rol?.id ?? null });
    await interaction.reply({ content: rol ? `✅ Rol de castigo configurado: ${rol}.` : '✅ Rol de castigo desactivado.', flags: MessageFlags.Ephemeral });
    await logConfigChange(interaction, rol ? `🚫 Rol de castigo → ${rol}` : '🚫 Rol de castigo desactivado');
    return;
  }

  if (sub === 'rol-automatico') {
    const rol = interaction.options.getRole('rol');
    if (rol) {
      const dangerousPermission = getDangerousRolePermission(rol);
      if (dangerousPermission) {
        await interaction.reply({
          content: `❌ ${rol} tiene el permiso **${dangerousPermission}**, así que no se puede usar como rol automático — el bot se lo daría a CADA miembro nuevo que se una, entregándole ese permiso por error. Elegí (o creá) un rol sin privilegios administrativos.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }
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

  if (sub === 'canal-anuncio-nivel') {
    const canal = interaction.options.getChannel('canal');
    await setGuildConfig(guildId, { xp_announce_channel_id: canal?.id ?? null });
    await interaction.reply({ content: canal ? `✅ Canal de anuncio de nivel configurado: ${canal}.` : '✅ Canal de anuncio de nivel desactivado.', flags: MessageFlags.Ephemeral });
    await logConfigChange(interaction, canal ? `📣 Canal de anuncio de nivel → ${canal}` : '📣 Canal de anuncio de nivel desactivado');
    return;
  }

  if (sub === 'rol-nivel') {
    const nivel = interaction.options.getInteger('nivel');
    const rol = interaction.options.getRole('rol');
    const cfg = await getGuildConfig(guildId);
    const levelRoles = { ...(cfg.level_roles || {}) };

    if (rol) levelRoles[nivel] = rol.id;
    else delete levelRoles[nivel];

    await setGuildConfig(guildId, { level_roles: levelRoles });
    await interaction.reply({
      content: rol ? `✅ A partir del nivel **${nivel}** se entrega ${rol}.` : `✅ Se quitó el rol asignado al nivel **${nivel}** (si tenía uno).`,
      flags: MessageFlags.Ephemeral,
    });
    await logConfigChange(interaction, rol ? `✨ Rol de nivel ${nivel} → ${rol}` : `✨ Rol de nivel ${nivel} quitado`);
    return;
  }

  if (sub === 'modo-roles-nivel') {
    const modo = interaction.options.getString('modo');
    await setGuildConfig(guildId, { level_roles_mode: modo });
    const modoTexto = modo === 'replace' ? 'Reemplazar (solo el más alto)' : 'Acumulativo (te quedás con todos)';
    await interaction.reply({ content: `✅ Modo de roles de nivel: **${modoTexto}**.`, flags: MessageFlags.Ephemeral });
    await logConfigChange(interaction, `✨ Modo de roles de nivel → ${modoTexto}`);
    return;
  }

  if (sub === 'confesiones-revision') {
    const activo = interaction.options.getBoolean('activo');
    await setGuildConfig(guildId, { confession_require_approval: activo });
    await interaction.reply({ content: activo ? '✅ Las confesiones ahora pasan por revisión del staff antes de publicarse.' : '✅ Las confesiones vuelven a publicarse directo, sin revisión.', flags: MessageFlags.Ephemeral });
    await logConfigChange(interaction, `🕵️ Revisión previa de confesiones → ${activo ? 'activada' : 'desactivada'}`);
    return;
  }

  if (sub === 'confesion-bloquear') {
    const usuario = interaction.options.getUser('usuario');
    const cfg = await getGuildConfig(guildId);
    const blocked = new Set(cfg.confession_blocked_ids || []);
    blocked.add(usuario.id);
    await setGuildConfig(guildId, { confession_blocked_ids: [...blocked] });
    await interaction.reply({ content: `✅ ${usuario.tag} ya no puede usar /confession en este servidor.`, flags: MessageFlags.Ephemeral });
    await logConfigChange(interaction, `🚫 ${usuario.tag} bloqueado de /confession`);
    return;
  }

  if (sub === 'confesion-desbloquear') {
    const usuario = interaction.options.getUser('usuario');
    const cfg = await getGuildConfig(guildId);
    const blocked = new Set(cfg.confession_blocked_ids || []);
    blocked.delete(usuario.id);
    await setGuildConfig(guildId, { confession_blocked_ids: [...blocked] });
    await interaction.reply({ content: `✅ ${usuario.tag} vuelve a poder usar /confession.`, flags: MessageFlags.Ephemeral });
    await logConfigChange(interaction, `✅ ${usuario.tag} desbloqueado de /confession`);
    return;
  }

  if (sub === 'xp-finde-boost') {
    const activo = interaction.options.getBoolean('activo');
    await setGuildConfig(guildId, { xp_weekend_boost: activo });
    await interaction.reply({ content: activo ? '✅ Sábado y domingo ahora dan el doble de XP.' : '✅ Impulso de finde desactivado.', flags: MessageFlags.Ephemeral });
    await logConfigChange(interaction, `🎉 Impulso de XP de finde → ${activo ? 'activado' : 'desactivado'}`);
    return;
  }

  if (sub === 'xp-canal-ignorar') {
    const canal = interaction.options.getChannel('canal');
    const cfg = await getGuildConfig(guildId);
    const ignored = new Set(cfg.xp_ignored_channel_ids || []);
    ignored.add(canal.id);
    await setGuildConfig(guildId, { xp_ignored_channel_ids: [...ignored] });
    await interaction.reply({ content: `✅ ${canal} ya no da XP por mensajes.`, flags: MessageFlags.Ephemeral });
    await logConfigChange(interaction, `🔇 ${canal} agregado a canales sin XP`);
    return;
  }

  if (sub === 'xp-canal-permitir') {
    const canal = interaction.options.getChannel('canal');
    const cfg = await getGuildConfig(guildId);
    const ignored = new Set(cfg.xp_ignored_channel_ids || []);
    ignored.delete(canal.id);
    await setGuildConfig(guildId, { xp_ignored_channel_ids: [...ignored] });
    await interaction.reply({ content: `✅ ${canal} vuelve a dar XP por mensajes.`, flags: MessageFlags.Ephemeral });
    await logConfigChange(interaction, `🔊 ${canal} quitado de canales sin XP`);
    return;
  }

  if (sub === 'canal-lol') {
    const canal = interaction.options.getChannel('canal');
    await setGuildConfig(guildId, { lol_announce_channel_id: canal?.id ?? null });
    await interaction.reply({ content: canal ? `✅ Patch notes de LoL configurados en ${canal}.` : '✅ Avisos de patch notes de LoL desactivados.', flags: MessageFlags.Ephemeral });
    await logConfigChange(interaction, canal ? `🎮 Canal de patch notes de LoL → ${canal}` : '🎮 Canal de patch notes de LoL desactivado');
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
      { name: '🧩 XP', value: toggle(features.xp), inline: true },
      { name: '✨ Roles de nivel', value: levelRolesCount > 0 ? `${levelRolesCount} configurado(s) (modo: ${cfg.level_roles_mode})` : '— sin configurar', inline: true },
      { name: '📣 Anuncio de nivel', value: channel(cfg.xp_announce_channel_id), inline: true },
      { name: '🔇 Canales sin XP', value: `${(cfg.xp_ignored_channel_ids || []).length}`, inline: true },
      { name: '🎉 Impulso de XP de finde', value: toggle(cfg.xp_weekend_boost), inline: true },
      { name: '🚫 Rol de castigo', value: role(cfg.punish_role_id), inline: true },
      { name: '🎫 Rol automático', value: role(cfg.auto_role_id), inline: true },
      { name: '🎉 Canal de bienvenida', value: channel(cfg.welcome_channel_id), inline: true },
      { name: '🤫 Canal de confesiones', value: channel(cfg.confession_channel_id), inline: true },
      { name: '🕵️ Revisión previa de confesiones', value: toggle(cfg.confession_require_approval), inline: true },
      { name: '🚷 Usuarios bloqueados de /confession', value: `${(cfg.confession_blocked_ids || []).length}`, inline: true },
      { name: '🎮 Canal de patch notes de LoL', value: channel(cfg.lol_announce_channel_id), inline: true },
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();

  if (cfg.setup_completed_at) {
    embed.addFields({ name: '🛠️ Última vez que se corrió /setup', value: `<t:${Math.floor(new Date(cfg.setup_completed_at).getTime() / 1000)}:R>` });
  }

  return embed;
}
