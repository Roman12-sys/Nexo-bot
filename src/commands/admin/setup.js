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
import { BRAND_COLOR, LOG_COLOR } from '../../utils/embeds.js';
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

// "Extras" del panel — a diferencia de moderación/economía/XP (que activan un módulo
// entero), cada uno de estos crea UN recurso puntual que hoy solo se podía configurar
// apuntando a algo ya existente con /config. Quedan todos apagados por defecto en
// cualquier plantilla — son opt-in explícito.
const EXTRAS = {
  bienvenida: {
    stateKey: 'bienvenida',
    emoji: '🎉',
    label: 'Bienvenida',
    description: 'Crea el canal #bienvenida — ahí se manda el banner + mensaje a cada miembro nuevo.',
  },
  confesiones: {
    stateKey: 'confesiones',
    emoji: '🤫',
    label: 'Confesiones',
    description: 'Crea el canal #confesiones — donde se publica lo que la gente manda con /confession, siempre anónimo.',
  },
  autoRol: {
    stateKey: 'autoRol',
    emoji: '🎫',
    label: 'Rol automático',
    description: 'Crea el rol "Miembro" y se lo asigna solo a cada persona que se une al servidor.',
  },
  castigo: {
    stateKey: 'castigo',
    emoji: '🚫',
    label: 'Rol de castigo',
    description: 'Crea el rol "Sancionado" — quien lo tenga no puede mandar imágenes ni enlaces (usado por /punish).',
  },
};

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
    .addFields(
      {
        name: 'Rol de staff',
        value: state.roleId ? `<@&${state.roleId}>` : 'Automático — crea o reusa uno llamado "Staff"',
      },
      {
        name: 'Extras (opcionales)',
        value: Object.values(EXTRAS)
          .map((e) => `${e.emoji} **${e.label}**: ${e.description}`)
          .join('\n'),
      },
    );

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

  const rowExtras = new ActionRowBuilder().addComponents(
    Object.values(EXTRAS).map((e) =>
      new ButtonBuilder()
        .setCustomId(`setup_toggle_${e.stateKey}`)
        .setLabel(toggleLabel(state[e.stateKey], e.label))
        .setStyle(state[e.stateKey] ? ButtonStyle.Success : ButtonStyle.Secondary),
    ),
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

  return { embeds: [embed], components: [rowToggles, rowExtras, rowRole, rowConfirm] };
}

// ---------- Creación/reuso de recursos ----------

// Genérico para cualquier rol que /setup pueda crear: reusa por ID guardado, después
// por nombre exacto, recién ahí crea uno nuevo — mismo criterio en los 3 roles que
// maneja el comando (staff, automático, castigo), nunca duplica si ya existe.
async function resolveRole(interaction, cfg, { column, name, color, hoist = false, requestedRole = null }) {
  if (requestedRole) return { role: requestedRole, created: false };

  if (cfg[column]) {
    const existing = await interaction.guild.roles.fetch(cfg[column]).catch(() => null);
    if (existing) return { role: existing, created: false };
  }

  const byName = interaction.guild.roles.cache.find((r) => r.name === name);
  if (byName) return { role: byName, created: false };

  const role = await interaction.guild.roles.create({
    name,
    color,
    hoist,
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

// Genérico para cualquier canal de texto que /setup pueda crear dentro de la categoría
// "Nexo Bot" — mismo criterio de reuso que resolveRole (ID guardado → nombre → crear).
// Los permisos los decide cada caller vía `overwrites` (los de log son staff-only, los
// de bienvenida/confesiones son visibles para todo el mundo).
async function resolveChannel(interaction, cfg, category, { column, name, overwrites }) {
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
    permissionOverwrites: overwrites,
    reason: 'Creado por /setup de Nexo Bot',
  });
  return { channel, created: true };
}

function staffOnlyOverwrites(interaction, staffRole) {
  return [
    { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: staffRole.id, allow: [PermissionFlagsBits.ViewChannel] },
  ];
}

// Corre la creación real a partir del estado elegido en el panel. Devuelve el embed
// de resumen final — se llama solo al tocar "Confirmar".
async function runSetup(interaction, state) {
  const cfg = await getGuildConfig(interaction.guildId);
  const summary = [];

  const requestedStaffRole = state.roleId ? await interaction.guild.roles.fetch(state.roleId).catch(() => null) : null;
  const { role: staffRole, created: staffCreated } = await resolveRole(interaction, cfg, {
    column: 'moderator_role_id',
    name: 'Staff',
    color: BRAND_COLOR,
    hoist: true,
    requestedRole: requestedStaffRole,
  });
  summary.push(`${staffCreated ? '🆕 Creado' : '♻️ Reusado'} rol de staff: ${staffRole}`);

  const needsCategory = state.moderacion || state.economia || state.bienvenida || state.confesiones;
  let category = null;
  if (needsCategory) {
    const result = await resolveCategory(interaction, cfg);
    category = result.category;
    summary.push(`${result.created ? '🆕 Creada' : '♻️ Reusada'} categoría: **${category.name}**`);
  }

  // Se persiste ACÁ (rol + categoría), apenas se resuelven — setGuildConfig hace un
  // upsert parcial (solo toca las columnas que se le pasan), así que esto no pisa
  // nada más de guild_config. Sin este guardado incremental, si algo más abajo fallaba
  // (ej. creando un canal de log), el rol/categoría ya creados en Discord quedaban sin
  // reflejarse acá hasta que se re-corriera /setup entero.
  await setGuildConfig(interaction.guildId, {
    admin_role_id: cfg.admin_role_id ?? staffRole.id,
    moderator_role_id: staffRole.id,
    features: { moderacion: state.moderacion, economia: state.economia, xp: state.xp },
    setup_category_id: category?.id ?? cfg.setup_category_id ?? null,
  });

  for (const logChannel of LOG_CHANNELS) {
    const isEconomyColumn = logChannel.column === 'log_channel_economy_id';
    const featureEnabled = isEconomyColumn ? state.economia : state.moderacion;
    if (!featureEnabled) continue;

    const { channel, created } = await resolveChannel(interaction, cfg, category, {
      ...logChannel,
      overwrites: staffOnlyOverwrites(interaction, staffRole),
    });
    summary.push(`${created ? '🆕 Creado' : '♻️ Reusado'} canal: ${channel}`);
    // Igual que arriba: se guarda cada canal apenas se crea, no recién al final.
    await setGuildConfig(interaction.guildId, { [logChannel.column]: channel.id });
  }

  if (state.xp) {
    summary.push('⭐ XP activado (sin canal de anuncio de nivel — configurable más adelante).');
  }

  // --- Extras opcionales ---

  if (state.bienvenida) {
    const { channel, created } = await resolveChannel(interaction, cfg, category, {
      column: 'welcome_channel_id',
      name: 'bienvenida',
      overwrites: [{ id: interaction.guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel] }],
    });
    summary.push(`${created ? '🆕 Creado' : '♻️ Reusado'} canal de bienvenida: ${channel}`);
    await setGuildConfig(interaction.guildId, { welcome_channel_id: channel.id });
  }

  if (state.confesiones) {
    const { channel, created } = await resolveChannel(interaction, cfg, category, {
      column: 'confession_channel_id',
      name: 'confesiones',
      // Visible para todos, pero solo el bot posta ahí (llegan vía /confession) — se
      // le niega Enviar mensajes a @everyone para que quede como feed de solo lectura.
      overwrites: [
        { id: interaction.guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
      ],
    });
    summary.push(`${created ? '🆕 Creado' : '♻️ Reusado'} canal de confesiones: ${channel}`);
    await setGuildConfig(interaction.guildId, { confession_channel_id: channel.id });
  }

  if (state.autoRol) {
    const { role, created } = await resolveRole(interaction, cfg, {
      column: 'auto_role_id',
      name: 'Miembro',
      color: '#43B581',
    });
    summary.push(`${created ? '🆕 Creado' : '♻️ Reusado'} rol automático: ${role}`);
    await setGuildConfig(interaction.guildId, { auto_role_id: role.id });
  }

  if (state.castigo) {
    const { role, created } = await resolveRole(interaction, cfg, {
      column: 'punish_role_id',
      name: 'Sancionado',
      color: LOG_COLOR,
    });
    summary.push(`${created ? '🆕 Creado' : '♻️ Reusado'} rol de castigo: ${role}`);
    await setGuildConfig(interaction.guildId, { punish_role_id: role.id });
  }

  await setGuildConfig(interaction.guildId, { setup_completed_at: new Date().toISOString() });

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

// Los extras arrancan siempre apagados, sin importar la plantilla — son opt-in
// explícito, ninguna plantilla los prende por vos.
const EXTRAS_DEFAULT_STATE = Object.fromEntries(Object.values(EXTRAS).map((e) => [e.stateKey, false]));

registerButtonPrefix('setup_template_', async (i) => {
  const key = i.customId.replace('setup_template_', '');
  const template = TEMPLATES[key];
  if (!template) return i.reply({ content: '❌ Plantilla inválida.', flags: MessageFlags.Ephemeral });

  const state = { ...EXTRAS_DEFAULT_STATE, ...template.state, roleId: null };
  refreshSession(i.user.id, state);
  await i.update(buildSetupPanel(state));
});

// Un solo handler genérico para los 7 toggles del panel (3 módulos + 4 extras) en vez
// de repetir el mismo bloque de 6 líneas siete veces.
function registerToggle(customId, stateKey) {
  registerButtonPrefix(customId, async (i) => {
    const session = requireSession(i);
    if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
    session.state[stateKey] = !session.state[stateKey];
    refreshSession(i.user.id, session.state);
    await i.update(buildSetupPanel(session.state));
  });
}

registerToggle('setup_toggle_moderacion', 'moderacion');
registerToggle('setup_toggle_economia', 'economia');
registerToggle('setup_toggle_xp', 'xp');
for (const extra of Object.values(EXTRAS)) {
  registerToggle(`setup_toggle_${extra.stateKey}`, extra.stateKey);
}

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
