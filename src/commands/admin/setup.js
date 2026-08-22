import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
} from 'discord.js';
import { getGuildConfig, setGuildConfig } from '../../utils/guildConfigStore.js';
import { BRAND_COLOR } from '../../utils/embeds.js';

const CATEGORY_NAME = 'Nexo Bot';

const LOG_CHANNELS = [
  { feature: 'moderacion', column: 'log_channel_moderation_id', name: 'registro-moderacion' },
  { feature: 'moderacion', column: 'log_channel_activity_id', name: 'registro-actividad' },
  { feature: 'economia', column: 'log_channel_economy_id', name: 'registro-economia' },
];

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Configura Nexo Bot para este servidor (roles, canales de log, features activas).')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addBooleanOption((opt) => opt.setName('moderacion').setDescription('Activar moderación (warnings, logs de moderación/actividad). Default: sí.'))
  .addBooleanOption((opt) => opt.setName('economia').setDescription('Activar economía (balance, daily, work, logs de economía). Default: sí.'))
  .addBooleanOption((opt) => opt.setName('xp').setDescription('Activar sistema de XP/niveles. Default: sí.'))
  .addRoleOption((opt) => opt.setName('rol_staff').setDescription('Rol de staff. Si no se indica, se crea o reusa uno llamado "Staff".'));

// No se puede usar isStaff() acá: la primera vez que se corre /setup todavía no
// hay guild_config, así que el único gate posible es "sos el dueño o tenés
// permiso de Administrador de Discord" (chequeo nativo vía setDefaultMemberPermissions
// + este chequeo explícito, por si el servidor cambió los permisos default del comando).
function canRunSetup(interaction) {
  return (
    interaction.guild.ownerId === interaction.user.id ||
    interaction.member.permissions.has(PermissionFlagsBits.Administrator)
  );
}

async function resolveStaffRole(interaction, cfg, requestedRole) {
  if (requestedRole) return { role: requestedRole, created: false };

  if (cfg.moderator_role_id) {
    const existing = await interaction.guild.roles.fetch(cfg.moderator_role_id).catch(() => null);
    if (existing) return { role: existing, created: false };
  }

  const byName = interaction.guild.roles.cache.find((r) => r.name === 'Staff');
  if (byName) return { role: byName, created: false };

  const role = await interaction.guild.roles.create({
    name: 'Staff',
    color: '#7F5AF0',
    hoist: true,
    reason: 'Creado por /setup de Nexo Bot',
  });
  return { role, created: true };
}

async function resolveCategory(interaction, cfg) {
  if (cfg.setup_category_id) {
    const existing = await interaction.guild.channels.fetch(cfg.setup_category_id).catch(() => null);
    if (existing?.type === ChannelType.GuildCategory) return { category: existing, created: false };
  }

  const byName = interaction.guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === CATEGORY_NAME,
  );
  if (byName) return { category: byName, created: false };

  const category = await interaction.guild.channels.create({
    name: CATEGORY_NAME,
    type: ChannelType.GuildCategory,
    reason: 'Creado por /setup de Nexo Bot',
  });
  return { category, created: true };
}

async function resolveLogChannel(interaction, cfg, category, staffRole, { column, name }) {
  const existingId = cfg[column];
  if (existingId) {
    const existing = await interaction.guild.channels.fetch(existingId).catch(() => null);
    if (existing) return { channel: existing, created: false };
  }

  const byName = interaction.guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.name === name && c.parentId === category.id,
  );
  if (byName) return { channel: byName, created: false };

  const channel = await interaction.guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: category.id,
    permissionOverwrites: [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: staffRole.id, allow: [PermissionFlagsBits.ViewChannel] },
    ],
    reason: 'Creado por /setup de Nexo Bot',
  });
  return { channel, created: true };
}

export async function execute(interaction) {
  if (!canRunSetup(interaction)) {
    await interaction.reply({ content: '❌ Solo el dueño del servidor o un administrador puede correr /setup.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const enableModeracion = interaction.options.getBoolean('moderacion') ?? true;
  const enableEconomia = interaction.options.getBoolean('economia') ?? true;
  const enableXp = interaction.options.getBoolean('xp') ?? true;
  const requestedStaffRole = interaction.options.getRole('rol_staff');

  const cfg = await getGuildConfig(interaction.guildId);
  const summary = [];

  const { role: staffRole, created: staffCreated } = await resolveStaffRole(interaction, cfg, requestedStaffRole);
  summary.push(`${staffCreated ? '🆕 Creado' : '♻️ Reusado'} rol de staff: ${staffRole}`);

  const needsCategory = enableModeracion || enableEconomia;
  let category = null;
  if (needsCategory) {
    const result = await resolveCategory(interaction, cfg);
    category = result.category;
    summary.push(`${result.created ? '🆕 Creada' : '♻️ Reusada'} categoría: **${category.name}**`);
  }

  const patch = {
    admin_role_id: cfg.admin_role_id ?? staffRole.id,
    moderator_role_id: staffRole.id,
    features: { moderacion: enableModeracion, economia: enableEconomia, xp: enableXp },
    setup_category_id: category?.id ?? cfg.setup_category_id ?? null,
    setup_completed_at: new Date().toISOString(),
  };

  for (const logChannel of LOG_CHANNELS) {
    const isModColumn = logChannel.column !== 'log_channel_economy_id';
    const featureEnabled = isModColumn ? enableModeracion : enableEconomia;
    if (!featureEnabled) continue;

    const { channel, created } = await resolveLogChannel(interaction, cfg, category, staffRole, logChannel);
    patch[logChannel.column] = channel.id;
    summary.push(`${created ? '🆕 Creado' : '♻️ Reusado'} canal: ${channel}`);
  }

  if (enableXp) {
    summary.push('⭐ XP activado (sin canal de anuncio de nivel — configurable más adelante).');
  }

  await setGuildConfig(interaction.guildId, patch);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('✅ Nexo Bot configurado')
    .setDescription(summary.join('\n'))
    .setFooter({ text: 'Podés volver a correr /setup cuando quieras — no duplica lo que ya existe.' });

  await interaction.editReply({ embeds: [embed] });
}
