import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import { getGuildConfig, setGuildConfig } from '../../utils/guildConfigStore.js';
import { BRAND_COLOR } from '../../utils/embeds.js';
import { registerButtonPrefix } from '../../components/buttons.js';
import { registerSelectPrefix } from '../../components/selects.js';

const CATEGORY_NAME = 'Nexo Bot';
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutos

// Plantillas: solo definen el punto de partida de los toggles del panel — el
// usuario los puede seguir tocando después, no queda atado a la plantilla elegida.
const TEMPLATES = {
  comunidad: {
    label: 'Comunidad',
    emoji: '👥',
    description: 'Moderación, economía y niveles activados. Ideal para comunidades grandes y activas.',
    state: { moderacion: true, economia: true, xp: true },
  },
  gaming: {
    label: 'Gaming / Clan',
    emoji: '🎮',
    description: 'Moderación y niveles por XP, sin economía. Pensado para clanes y comunidades de juego.',
    state: { moderacion: true, economia: false, xp: true },
  },
  estudio: {
    label: 'Estudio / Soporte',
    emoji: '📚',
    description: 'Solo moderación y logs. Ideal para servidores de estudio, trabajo o soporte.',
    state: { moderacion: true, economia: false, xp: false },
  },
  personalizado: {
    label: 'Personalizado',
    emoji: '🛠️',
    description: 'Arrancá en blanco y activá lo que necesites vos mismo.',
    state: { moderacion: false, economia: false, xp: false },
  },
};

const LOG_CHANNELS = [
  { column: 'log_channel_moderation_id', name: 'registro-moderacion' },
  { column: 'log_channel_activity_id', name: 'registro-actividad' },
  { column: 'log_channel_economy_id', name: 'registro-economia' },
];

// Sesión en memoria del panel interactivo, una por usuario (mismo patrón que
// anuncio.js) — solo importa mientras dura la conversación de botones, nunca se
// persiste. Lo que sí se persiste es guild_config, recién al confirmar.
const sessions = new Map();

function refreshSession(userId, state) {
  const existing = sessions.get(userId);
  if (existing?.timeoutHandle) clearTimeout(existing.timeoutHandle);
  const timeoutHandle = setTimeout(() => sessions.delete(userId), SESSION_TTL_MS);
  sessions.set(userId, { state, timeoutHandle });
}

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Configura Nexo Bot para este servidor (roles, canales de log, features activas).')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

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

// ---------- Selección de plantilla (paso previo al panel) ----------

function buildTemplatePicker() {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('⚙️ Configurar Nexo Bot')
    .setDescription(
      'Elegí una plantilla como punto de partida — después vas a poder ajustar cada opción a mano. ' +
        'Ninguna elección es definitiva, todo se puede tocar antes de confirmar.',
    )
    .addFields(
      Object.entries(TEMPLATES).map(([, t]) => ({ name: `${t.emoji} ${t.label}`, value: t.description })),
    );

  const row = new ActionRowBuilder().addComponents(
    Object.entries(TEMPLATES).map(([key, t]) =>
      new ButtonBuilder().setCustomId(`setup_template_${key}`).setLabel(t.label).setEmoji(t.emoji).setStyle(ButtonStyle.Secondary),
    ),
  );

  return { embeds: [embed], components: [row] };
}

// ---------- Panel interactivo ----------

function buildSetupPanel(state) {
  const toggleLabel = (enabled, label) => `${enabled ? '✅' : '⬜'} ${label}`;

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('⚙️ Configurar Nexo Bot')
    .setDescription(
      'Elegí qué activar y, si querés, un rol de staff ya existente. Tocá **Confirmar** cuando esté listo — ' +
        'se puede volver a correr /setup las veces que hagan falta, nunca duplica lo que ya existe.',
    )
    .addFields({
      name: 'Rol de staff',
      value: state.roleId ? `<@&${state.roleId}>` : 'Automático — crea o reusa uno llamado "Staff"',
    });

  const rowToggles = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('setup_toggle_moderacion')
      .setLabel(toggleLabel(state.moderacion, 'Moderación'))
      .setStyle(state.moderacion ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('setup_toggle_economia')
      .setLabel(toggleLabel(state.economia, 'Economía'))
      .setStyle(state.economia ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('setup_toggle_xp')
      .setLabel(toggleLabel(state.xp, 'XP'))
      .setStyle(state.xp ? ButtonStyle.Success : ButtonStyle.Secondary),
  );

  const rowRole = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('setup_role_select')
      .setPlaceholder('Elegí un rol de staff existente (opcional)')
      .setMinValues(0)
      .setMaxValues(1),
  );

  const rowConfirm = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('setup_confirm').setLabel('✅ Confirmar').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('setup_cancel').setLabel('❌ Cancelar').setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [rowToggles, rowRole, rowConfirm] };
}

// ---------- Creación/reuso de recursos (sin cambios de lógica) ----------

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

// Corre la creación real a partir del estado elegido en el panel. Devuelve el embed
// de resumen final — se llama solo al tocar "Confirmar".
async function runSetup(interaction, state) {
  const cfg = await getGuildConfig(interaction.guildId);
  const summary = [];

  const requestedStaffRole = state.roleId ? await interaction.guild.roles.fetch(state.roleId).catch(() => null) : null;
  const { role: staffRole, created: staffCreated } = await resolveStaffRole(interaction, cfg, requestedStaffRole);
  summary.push(`${staffCreated ? '🆕 Creado' : '♻️ Reusado'} rol de staff: ${staffRole}`);

  const needsCategory = state.moderacion || state.economia;
  let category = null;
  if (needsCategory) {
    const result = await resolveCategory(interaction, cfg);
    category = result.category;
    summary.push(`${result.created ? '🆕 Creada' : '♻️ Reusada'} categoría: **${category.name}**`);
  }

  const patch = {
    admin_role_id: cfg.admin_role_id ?? staffRole.id,
    moderator_role_id: staffRole.id,
    features: { moderacion: state.moderacion, economia: state.economia, xp: state.xp },
    setup_category_id: category?.id ?? cfg.setup_category_id ?? null,
    setup_completed_at: new Date().toISOString(),
  };

  for (const logChannel of LOG_CHANNELS) {
    const isEconomyColumn = logChannel.column === 'log_channel_economy_id';
    const featureEnabled = isEconomyColumn ? state.economia : state.moderacion;
    if (!featureEnabled) continue;

    const { channel, created } = await resolveLogChannel(interaction, cfg, category, staffRole, logChannel);
    patch[logChannel.column] = channel.id;
    summary.push(`${created ? '🆕 Creado' : '♻️ Reusado'} canal: ${channel}`);
  }

  if (state.xp) {
    summary.push('⭐ XP activado (sin canal de anuncio de nivel — configurable más adelante).');
  }

  await setGuildConfig(interaction.guildId, patch);

  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('✅ Nexo Bot configurado')
    .setDescription(summary.join('\n'))
    .setFooter({ text: 'Podés volver a correr /setup cuando quieras — no duplica lo que ya existe.' });
}

// ---------- Entrada del comando ----------

export async function execute(interaction) {
  if (!canRunSetup(interaction)) {
    await interaction.reply({ content: '❌ Solo el dueño del servidor o un administrador puede correr /setup.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({ ...buildTemplatePicker(), flags: MessageFlags.Ephemeral });
}

function requireSession(interaction) {
  return sessions.get(interaction.user.id) || null;
}

const SESSION_EXPIRED = '❌ Esta sesión de /setup expiró. Iniciá de nuevo con `/setup`.';

registerButtonPrefix('setup_template_', async (i) => {
  const key = i.customId.replace('setup_template_', '');
  const template = TEMPLATES[key];
  if (!template) return i.reply({ content: '❌ Plantilla inválida.', flags: MessageFlags.Ephemeral });

  const state = { ...template.state, roleId: null };
  refreshSession(i.user.id, state);
  await i.update(buildSetupPanel(state));
});

registerButtonPrefix('setup_toggle_moderacion', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
  session.state.moderacion = !session.state.moderacion;
  refreshSession(i.user.id, session.state);
  await i.update(buildSetupPanel(session.state));
});

registerButtonPrefix('setup_toggle_economia', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
  session.state.economia = !session.state.economia;
  refreshSession(i.user.id, session.state);
  await i.update(buildSetupPanel(session.state));
});

registerButtonPrefix('setup_toggle_xp', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
  session.state.xp = !session.state.xp;
  refreshSession(i.user.id, session.state);
  await i.update(buildSetupPanel(session.state));
});

registerSelectPrefix('setup_role_select', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
  session.state.roleId = i.values[0] || null;
  refreshSession(i.user.id, session.state);
  await i.update(buildSetupPanel(session.state));
});

registerButtonPrefix('setup_confirm', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });

  await i.update({ content: '⏳ Configurando...', embeds: [], components: [] });

  try {
    const summaryEmbed = await runSetup(i, session.state);
    sessions.delete(i.user.id);
    await i.editReply({ content: null, embeds: [summaryEmbed], components: [] });
  } catch (error) {
    console.error('❌ Error al confirmar /setup:', error);
    await i.editReply({ content: '❌ Ocurrió un error configurando el servidor. Probá de nuevo.', embeds: [], components: [] });
  }
});

registerButtonPrefix('setup_cancel', async (i) => {
  sessions.delete(i.user.id);
  await i.update({ content: '❌ /setup cancelado.', embeds: [], components: [] });
});
