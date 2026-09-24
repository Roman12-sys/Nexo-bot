import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} from 'discord.js';
import { getGuildConfig, setGuildConfig } from '../../utils/guildConfigStore.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';
import { createBotConfigLogEmbed } from '../../utils/logEmbeds.js';
import { getDangerousRolePermission } from '../../utils/permissions.js';
import { getMissingBotPermissions } from '../../utils/botPermissions.js';
import { describeError } from '../../utils/errorMessages.js';
import { BRAND_COLOR, LOG_COLOR, SUCCESS_COLOR, GOLD_COLOR, NEUTRAL_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { registerButtonPrefix } from '../../components/buttons.js';
import { registerSelectPrefix } from '../../components/selects.js';
import { registerModalPrefix } from '../../components/modals.js';
import { config } from '../../config.js';
import { withLock } from '../../utils/asyncLock.js';
import { buildConfirmation } from '../../utils/confirmations.js';
import { getSetupStatus, STATUS, STATUS_EMOJI, countPendingSections } from '../../utils/setupState.js';
import {
  ROLE_TIERS,
  ROLE_TIER_ORDER,
  DEFAULT_SELECTED_TIERS,
  describeTierPermissions,
  isValidHexColor,
  normalizeHexColor,
} from '../../utils/setupRoleTiers.js';
import { scanGuildChannels, scanGuildRoles, groupFindingsByCategory, applyChannelCorrection } from '../../utils/setupDiagnostics.js';
import { syncMemberCounterForGuild, buildCounterChannelName } from '../../utils/memberCounterEngine.js';
import { buildWelcomePreviewEmbed, contextFromInteraction, DEFAULT_WELCOME_TITLE, DEFAULT_WELCOME_DESCRIPTION } from '../../utils/welcomeEmbed.js';
import { hasCustomShopItems } from '../../utils/shopStore.js';

const CATEGORY_NAME = 'Nexo Bot';
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutos

// QUÉ CAMBIÓ: se sacó el toggle "Economía" (y la clave `economia` de todos los
// estados). La plantilla "Gaming / Clan" quedó fusionada con "Comunidad" — sin ese
// toggle, ambas producían exactamente el mismo estado (moderación+XP activados), tener
// dos botones que hacían lo mismo con distinto texto era peor que tener uno solo.
// MOTIVO: auditoría 2026-08-29 (Diagnóstico Nexo, Parte 22) — features.economia nunca
// gateaba ningún comando de economía (/daily, /work, etc. siempre estuvieron activos
// sin importar este toggle); su único efecto real era decidir si /setup creaba el
// canal de logs de economía, ahora eso lo decide `moderacion` (ver runSetup más abajo),
// igual que ya decidía el canal de logs de actividad.
// Plantillas: solo definen el punto de partida de los toggles del panel — el
// usuario los puede seguir tocando después, no queda atado a la plantilla elegida.
const TEMPLATES = {
  comunidad: {
    label: 'Comunidad',
    emoji: '👥',
    description: 'Moderación y niveles activados. Ideal para comunidades grandes y activas.',
    state: { moderacion: true, xp: true },
  },
  estudio: {
    label: 'Estudio / Soporte',
    emoji: '📚',
    description: 'Solo moderación y logs. Ideal para servidores de estudio, trabajo o soporte.',
    state: { moderacion: true, xp: false },
  },
  personalizado: {
    label: 'Personalizado',
    emoji: '🛠️',
    description: 'Arrancá en blanco y activá lo que necesites vos mismo.',
    state: { moderacion: false, xp: false },
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

// Sesión en memoria del panel interactivo, una por (guild, usuario) — mismo patrón
// que anuncio.js — solo importa mientras dura la conversación de botones, nunca se
// persiste. Lo que sí se persiste es guild_config, recién al confirmar.
//
// La key ES `${guildId}:${userId}`, nunca solo `userId`: un admin que administra
// varios servidores (escenario esperado — Nexo es multi-tenant) puede tener /setup
// abierto en Guild A y arrancar otro /setup en Guild B antes de confirmar el primero.
// Con la key vieja (solo userId) la segunda sesión pisaba silenciosamente la primera
// y "Confirmar" en el panel de A terminaba corriendo con los datos de B. Ver auditoría
// adversarial round 2, Bloque 1.
const sessions = new Map();

function sessionKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function refreshSession(key, state) {
  const existing = sessions.get(key);
  if (existing?.timeoutHandle) clearTimeout(existing.timeoutHandle);
  const timeoutHandle = setTimeout(() => sessions.delete(key), SESSION_TTL_MS);
  sessions.set(key, { state, timeoutHandle });
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
    Boolean(interaction.member?.permissions?.has(PermissionFlagsBits.Administrator))
  );
}

// Cada botón/select/modal del panel revalida el MISMO gate que execute(). Que el panel
// sea ephemeral (hoy nadie más lo ve) es un supuesto del cliente de Discord, no una
// garantía del código — mismo criterio que /staff, que revalida en cada superficie.
// Registrar siempre con estos wrappers (nunca con registerButtonPrefix & cía. directo)
// hace que un handler nuevo de /setup nazca protegido. Auditoría 2026-09-23: antes de
// esto, 0 de los 26 registros de este archivo revalidaban el permiso.
const SETUP_DENIED = '❌ Solo el dueño del servidor o un administrador puede usar /setup.';

function guardSetup(handler) {
  return async (i) => {
    if (!canRunSetup(i)) return i.reply({ content: SETUP_DENIED, flags: MessageFlags.Ephemeral });
    return handler(i);
  };
}

const registerSetupButton = (prefix, handler) => registerButtonPrefix(prefix, guardSetup(handler));
const registerSetupSelect = (prefix, handler) => registerSelectPrefix(prefix, guardSetup(handler));
const registerSetupModal = (prefix, handler) => registerModalPrefix(prefix, guardSetup(handler));

// ---------- Selección de plantilla (paso previo al panel) ----------

function buildTemplatePicker() {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('⚙️ Configurar Nexo Bot')
    .setDescription(
      '**NEXO** es la plataforma para administrar y hacer crecer tu comunidad de Discord — economía, progresión, ' +
        'moderación y herramientas de gestión, todo en un solo lugar.\n\n' +
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
//
// rejectDangerous (Fase 1.1): SOLO lo pasan en true los llamados de auto_role_id/
// punish_role_id — el rol de staff está pensado para tener privilegios reales, no
// corresponde bloquearlo con la misma política. Cuando está en true, un candidato de
// reuso (por ID guardado o por nombre) con un permiso de getDangerousRolePermission()
// (misma política central que ya usa /config, src/utils/permissions.js — no se duplica
// acá) se descarta en vez de reusarse silenciosamente, y en su lugar se crea un rol
// nuevo — nunca se interrumpe /setup a mitad de camino por esto, pero tampoco se asigna
// nunca un rol peligroso. skippedDangerousPermission (si no es null) le avisa al caller
// qué pasó, para que el resumen final se lo explique al admin en vez de quedar en
// silencio.
async function resolveRole(interaction, cfg, { column, name, color, hoist = false, requestedRole = null, rejectDangerous = false }) {
  if (requestedRole) return { role: requestedRole, created: false };

  let skippedDangerousPermission = null;

  if (cfg[column]) {
    const existing = await interaction.guild.roles.fetch(cfg[column]).catch(() => null);
    if (existing) {
      const dangerous = rejectDangerous ? getDangerousRolePermission(existing) : null;
      if (!dangerous) return { role: existing, created: false };
      skippedDangerousPermission = dangerous;
    }
  }

  const byName = interaction.guild.roles.cache.find((r) => r.name === name);
  if (byName) {
    const dangerous = rejectDangerous ? getDangerousRolePermission(byName) : null;
    if (!dangerous) return { role: byName, created: false };
    skippedDangerousPermission = dangerous;
  }

  const role = await interaction.guild.roles.create({
    name,
    color,
    hoist,
    reason: 'Creado por /setup de Nexo Bot',
  });
  return { role, created: true, skippedDangerousPermission };
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
async function resolveChannel(interaction, cfg, category, { column, name, overwrites, type = ChannelType.GuildText }) {
  const existingId = cfg[column];
  if (existingId) {
    const existing = await interaction.guild.channels.fetch(existingId).catch(() => null);
    if (existing) return { channel: existing, created: false };
  }

  const byName = interaction.guild.channels.cache.find(
    (c) => c.type === type && c.name === name && (category ? c.parentId === category.id : true),
  );
  if (byName) return { channel: byName, created: false };

  const channel = await interaction.guild.channels.create({
    name,
    type,
    parent: category?.id,
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

  const needsCategory = state.moderacion || state.bienvenida || state.confesiones;
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
    features: { moderacion: state.moderacion, xp: state.xp },
    setup_category_id: category?.id ?? cfg.setup_category_id ?? null,
  });

  // Los 3 logs (moderación/actividad/economía) se crean juntos con `moderacion` — los
  // comandos de economía están siempre activos sin importar ningún toggle, así que no
  // tiene sentido gatear su canal de log por separado (ver comentario de TEMPLATES).
  for (const logChannel of LOG_CHANNELS) {
    if (!state.moderacion) continue;

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
    const { role, created, skippedDangerousPermission } = await resolveRole(interaction, cfg, {
      column: 'auto_role_id',
      name: 'Miembro',
      // Auditoría NEXO V (2026-09-18): era el verde obsoleto de Discord pre-2020
      // (#43B581), hardcodeado a mano — ahora el SUCCESS_COLOR oficial del sistema.
      color: SUCCESS_COLOR,
      rejectDangerous: true,
    });
    summary.push(
      skippedDangerousPermission
        ? `⚠️ Ya existía un rol "Miembro" con el permiso **${skippedDangerousPermission}** — no se reusó (se lo asignaría a CADA miembro nuevo). Se creó ${role} en su lugar.`
        : `${created ? '🆕 Creado' : '♻️ Reusado'} rol automático: ${role}`,
    );
    await setGuildConfig(interaction.guildId, { auto_role_id: role.id });
  }

  if (state.castigo) {
    const { role, created, skippedDangerousPermission } = await resolveRole(interaction, cfg, {
      column: 'punish_role_id',
      name: 'Sancionado',
      color: LOG_COLOR,
      rejectDangerous: true,
    });
    summary.push(
      skippedDangerousPermission
        ? `⚠️ Ya existía un rol "Sancionado" con el permiso **${skippedDangerousPermission}** — no se reusó (el bot se lo agregaría a cualquier usuario sancionado). Se creó ${role} en su lugar.`
        : `${created ? '🆕 Creado' : '♻️ Reusado'} rol de castigo: ${role}`,
    );
    await setGuildConfig(interaction.guildId, { punish_role_id: role.id });
  }

  await setGuildConfig(interaction.guildId, { setup_completed_at: new Date().toISOString() });

  // Best-effort: /setup ya le mostró el resumen completo a quien lo corrió (ephemeral),
  // esto es solo para que quede un rastro en el canal de logs — igual que cualquier otro
  // cambio de configuración vía /config. Nunca debe romper la confirmación si falla.
  try {
    const logChannel = await getGuildLogChannel(interaction.client, interaction.guildId, 'activity');
    if (logChannel) {
      await logChannel.send({ embeds: [createBotConfigLogEmbed({ executor: interaction.user, changes: summary })] });
    }
  } catch (error) {
    console.error('⚠️ No se pudo registrar /setup en el canal de logs:', error);
  }

  // Próximos pasos (Fase 4C-1, onboarding): acciones concretas con comandos que
  // REALMENTE existen (nunca inventados) — /daily porque economía está siempre activa,
  // /nivel solo si el módulo que lo sostiene quedó prendido en este mismo /setup. El link
  // del dashboard solo aparece si config.dashboardUrl está configurado (nunca una URL
  // inventada) — /guild/:id es la ruta real de dashboard/server.js.
  //
  // QUÉ CAMBIÓ (auditoría completa NEXO, 2026-09-11): se suma /staff. El panel visual de
  // 8 fases (moderación, economía, XP, roles, sorteos, anuncios y más, todo con botones)
  // no aparecía mencionado en NINGÚN lugar del producto — ni acá, ni en /help, ni en
  // /helpstaff — así que un admin nuevo no tenía forma de enterarse de que existe salvo
  // que alguien se lo dijera de afuera. Es quien acaba de correr /setup el destinatario
  // exacto de esta recomendación.
  const nextSteps = [
    '🎛️ `/staff` — panel de administración con botones, para no tener que memorizar comandos.',
    '🔎 `/help` — mirá todos los comandos disponibles.',
    '💰 `/daily` — probá la economía (recompensa diaria).',
  ];
  if (state.xp) nextSteps.push('⭐ `/nivel` — mirá tu tarjeta de XP y nivel.');
  if (config.dashboardUrl) {
    nextSteps.push(`📊 [Panel de este servidor](${config.dashboardUrl}/guild/${interaction.guildId}) — actividad, economía y moderación de un vistazo.`);
  }

  const summaryEmbed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('✅ NEXO está listo')
    .setDescription(`Tu comunidad ya tiene a NEXO administrando esto. Repaso de lo que quedó configurado:\n\n${summary.join('\n')}`)
    .addFields({ name: '🚀 Próximos pasos', value: nextSteps.join('\n') })
    .setFooter({ text: 'Podés volver a correr /setup cuando quieras — no duplica lo que ya existe.' });

  // PERM-2 (Fase 4C-1): antes, si un admin sacaba un permiso durante la instalación (o
  // Discord no lo pre-tildaba porque el invite no llevaba `permissions=`, ver
  // dashboard/html.js), la única señal de que algo estaba mal era una feature fallando en
  // silencio más tarde. Se chequea acá, al final, porque recién acá el bot ya tiene un rol
  // real en el server con el que medir sus propios permisos.
  const missingPermissions = getMissingBotPermissions(interaction.guild);
  if (missingPermissions.length > 0) {
    summaryEmbed.addFields({
      name: '⚠️ Permisos faltantes',
      value:
        missingPermissions.map((p) => `**${p.label}** — afecta: ${p.feature}`).join('\n').slice(0, 1000) +
        '\n\nCorregilo en *Ajustes del servidor → Roles* → el rol de Nexo Bot.',
    });
  }

  return summaryEmbed;
}

// ---------- Panel principal (NEXO Setup Inteligente, Bloque 15/16) ----------
//
// A diferencia del panel de arriba (plantilla → toggles → confirmar, un solo pasada),
// este es el punto de entrada REAL de /setup desde ahora: siempre muestra el estado
// verdadero del servidor (derivado en vivo por getSetupStatus, sin ninguna tabla de
// "progreso del wizard" — Bloque 16, "no depender de memoria en RAM si se puede derivar
// del estado real"). El flujo viejo de plantillas sigue existiendo tal cual, sin tocarse
// una línea — ahora es una acción más ("🚀 Configuración rápida") alcanzable desde acá.
function buildHomePanel(cfg, status) {
  const pending = countPendingSections(status);
  const line = (label, s) => `${STATUS_EMOJI[s.status]} ${label}`;

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(cfg.setup_completed_at ? '⚙️ NEXO Setup' : '⚙️ Vamos a preparar tu servidor')
    .setDescription(
      cfg.setup_completed_at
        ? pending === 0
          ? '🎉 Todo listo — no hay nada pendiente ahora mismo.'
          : `${pending} sección(es) requieren atención — mirá abajo y usá los botones para revisarlas.`
        : 'NEXO revisó la estructura actual de tu servidor y te muestra qué está bien, qué falta y qué podés configurar. Nada se toca sin que lo confirmes.',
    )
    .addFields(
      { name: line('Roles de staff', status.roles), value: status.roles.detail, inline: true },
      { name: line('Moderación', status.moderacion), value: status.moderacion.detail, inline: true },
      { name: line('Bienvenida', status.bienvenida), value: status.bienvenida.detail, inline: true },
      { name: line('Economía', status.economia), value: status.economia.detail, inline: true },
      { name: line('Casino', status.casino), value: status.casino.detail, inline: true },
      { name: line('Permisos del bot', status.permisosBot), value: status.permisosBot.detail, inline: true },
    )
    .setFooter({ text: 'Podés salir cuando quieras y volver a correr /setup — siempre vas a ver el estado real, nunca se pierde nada.' });

  const rowSections = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('setuphome_roles').setLabel('Roles').setEmoji('🛡️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('setuphome_welcome').setLabel('Bienvenida').setEmoji('🎉').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('setuphome_diagnostics').setLabel('Canales').setEmoji('🔎').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('setuphome_counter').setLabel('Contador').setEmoji('👥').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('setuphome_economy').setLabel('Economía/Casino').setEmoji('💰').setStyle(ButtonStyle.Secondary),
  );
  const rowQuickstart = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('setuphome_quickstart').setLabel('🚀 Configuración rápida (roles + canales de log)').setStyle(ButtonStyle.Primary),
  );

  return { embeds: [embed], components: [rowSections, rowQuickstart] };
}

async function renderHome(interaction, guild, guildId) {
  const cfg = await getGuildConfig(guildId);
  const status = await getSetupStatus(guild, cfg);
  return buildHomePanel(cfg, status);
}

// ---------- Entrada del comando ----------

export async function execute(interaction) {
  if (!canRunSetup(interaction)) {
    await interaction.reply({ content: '❌ Solo el dueño del servidor o un administrador puede correr /setup.', flags: MessageFlags.Ephemeral });
    return;
  }

  const payload = await renderHome(interaction, interaction.guild, interaction.guildId);
  await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

function requireSession(interaction) {
  return sessions.get(sessionKey(interaction.guildId, interaction.user.id)) || null;
}

const SESSION_EXPIRED = '❌ Esta sesión de /setup expiró. Iniciá de nuevo con `/setup`.';

// Los extras arrancan siempre apagados, sin importar la plantilla — son opt-in
// explícito, ninguna plantilla los prende por vos.
const EXTRAS_DEFAULT_STATE = Object.fromEntries(Object.values(EXTRAS).map((e) => [e.stateKey, false]));

registerSetupButton('setup_template_', async (i) => {
  const key = i.customId.replace('setup_template_', '');
  const template = TEMPLATES[key];
  if (!template) return i.reply({ content: '❌ Plantilla inválida.', flags: MessageFlags.Ephemeral });

  const state = { ...EXTRAS_DEFAULT_STATE, ...template.state, roleId: null };
  refreshSession(sessionKey(i.guildId, i.user.id), state);
  await i.update(buildSetupPanel(state));
});

// Un solo handler genérico para los 7 toggles del panel (3 módulos + 4 extras) en vez
// de repetir el mismo bloque de 6 líneas siete veces.
function registerToggle(customId, stateKey) {
  registerSetupButton(customId, async (i) => {
    const session = requireSession(i);
    if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
    session.state[stateKey] = !session.state[stateKey];
    refreshSession(sessionKey(i.guildId, i.user.id), session.state);
    await i.update(buildSetupPanel(session.state));
  });
}

registerToggle('setup_toggle_moderacion', 'moderacion');
registerToggle('setup_toggle_xp', 'xp');
for (const extra of Object.values(EXTRAS)) {
  registerToggle(`setup_toggle_${extra.stateKey}`, extra.stateKey);
}

registerSetupSelect('setup_role_select', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
  session.state.roleId = i.values[0] || null;
  refreshSession(sessionKey(i.guildId, i.user.id), session.state);
  await i.update(buildSetupPanel(session.state));
});

registerSetupButton('setup_confirm', async (i) => {
  const session = requireSession(i);
  if (!session) return i.reply({ content: SESSION_EXPIRED, flags: MessageFlags.Ephemeral });

  await i.update({ content: '⏳ Configurando...', embeds: [], components: [] });

  try {
    const summaryEmbed = await runSetup(i, session.state);
    sessions.delete(sessionKey(i.guildId, i.user.id));
    await i.editReply({ content: null, embeds: [summaryEmbed], components: [] });
  } catch (error) {
    console.error('❌ Error al confirmar /setup:', error);
    // H10, auditoría completa NEXO — /setup crea canales/roles reales; si al bot le
    // falta un permiso (ManageChannels/ManageRoles) justo en este paso, un admin
    // instalando el bot por primera vez se merece saber QUÉ pasó, no un genérico
    // "probá de nuevo" que lo manda a mirar logs que no tiene.
    await i.editReply({
      content: describeError(error, '❌ Ocurrió un error configurando el servidor. Probá de nuevo.'),
      embeds: [],
      components: [],
    });
  }
});

registerSetupButton('setup_cancel', async (i) => {
  sessions.delete(sessionKey(i.guildId, i.user.id));
  await i.update({ content: '❌ /setup cancelado.', embeds: [], components: [] });
});

// ============================================================================
// NEXO Setup Inteligente — panel principal, wizard de roles, diagnóstico de canales,
// contador de miembros, editor de bienvenida, economía/casino.
//
// Sesión APARTE de `sessions` (arriba, la del flujo de plantilla/toggles) a propósito
// — cero riesgo de tocar el Map que ya usan setupOnboarding/setupRoleSafety/
// setupSessionIsolation/setupErrorHandling.test.js. Mismo patrón (TTL 10 min, key
// `guildId:userId`).
// ============================================================================

const wizardSessions = new Map();

function wizardKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function refreshWizardSession(key, draft) {
  const existing = wizardSessions.get(key);
  if (existing?.timeoutHandle) clearTimeout(existing.timeoutHandle);
  const timeoutHandle = setTimeout(() => wizardSessions.delete(key), SESSION_TTL_MS);
  wizardSessions.set(key, { draft, timeoutHandle });
}

function requireWizardSession(interaction) {
  return wizardSessions.get(wizardKey(interaction.guildId, interaction.user.id)) || null;
}

// A diferencia de requireWizardSession (falla si no hay sesión), esto crea una sesión
// nueva la primera vez que se entra a cualquier sub-pantalla desde el panel principal —
// no hace falta un paso explícito de "iniciar sesión", entrar a la sección ya alcanza.
function ensureWizardSession(interaction) {
  const key = wizardKey(interaction.guildId, interaction.user.id);
  let session = wizardSessions.get(key);
  if (!session) {
    refreshWizardSession(key, {
      rolesDraft: { selectedTiers: [...DEFAULT_SELECTED_TIERS], overrides: {}, lastCreated: [], wiringAdminRoleId: null, wiringModeratorRoleId: null },
      welcomeDraft: {},
      diagnosticsFindings: [],
    });
    session = wizardSessions.get(key);
  }
  return session;
}

const WIZARD_SESSION_EXPIRED = '❌ Esta sesión expiró. Volvé a abrir la sección desde `/setup`.';

// ---------- Navegación genérica ----------

registerSetupButton('setuphome_quickstart', async (i) => {
  await i.update(buildTemplatePicker());
});

registerSetupButton('setuphome_back', async (i) => {
  const payload = await renderHome(i, i.guild, i.guildId);
  await i.update(payload);
});

// ---------- Bloque 1-5: wizard de roles de staff ----------

function buildRoleWizardPanel(rolesDraft) {
  const selected = rolesDraft.selectedTiers;

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🛡️ Roles de staff')
    .setDescription(
      selected.length === 0
        ? 'Elegí qué roles de staff querés crear — nada se crea todavía, esto es solo el borrador.'
        : 'Así van a quedar los roles elegidos (nombre, color y permisos NATIVOS de Discord — distinto del tier interno de NEXO, que se asigna después de crear). Tocá el segundo selector para editar nombre/color, o **Crear** cuando estén listos.',
    );

  for (const tierKey of ROLE_TIER_ORDER) {
    if (!selected.includes(tierKey)) continue;
    const tier = ROLE_TIERS[tierKey];
    const override = rolesDraft.overrides[tierKey] || {};
    const name = override.name || tier.defaultName;
    const color = override.color || tier.defaultColor;
    embed.addFields({
      name: `${tier.emoji} ${name}`,
      value: `Color \`${color}\` — ${tier.summary}\n\n**Permisos nativos de Discord:**\n${describeTierPermissions(tierKey)}`,
    });
  }

  const tierSelect = new StringSelectMenuBuilder()
    .setCustomId('setupwizard_roles_select')
    .setPlaceholder('Elegí qué roles de staff crear')
    .setMinValues(0)
    .setMaxValues(ROLE_TIER_ORDER.length)
    .addOptions(
      ROLE_TIER_ORDER.map((key) =>
        new StringSelectMenuOptionBuilder().setLabel(ROLE_TIERS[key].label).setValue(key).setEmoji(ROLE_TIERS[key].emoji).setDefault(selected.includes(key)),
      ),
    );

  const rows = [new ActionRowBuilder().addComponents(tierSelect)];

  if (selected.length > 0) {
    const editSelect = new StringSelectMenuBuilder()
      .setCustomId('setupwizard_roles_edittarget_select')
      .setPlaceholder('✏️ Editar nombre/color de un rol elegido')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(selected.map((key) => new StringSelectMenuOptionBuilder().setLabel(`Editar: ${ROLE_TIERS[key].label}`).setValue(key).setEmoji('✏️')));
    rows.push(new ActionRowBuilder().addComponents(editSelect));
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setuphome_back').setLabel('⬅️ Volver').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('setupwizard_roles_create')
        .setLabel(selected.length === 0 ? 'Continuar (asignar tiers a roles existentes)' : `✅ Crear ${selected.length} rol(es)`)
        .setStyle(ButtonStyle.Success),
    ),
  );

  return { embeds: [embed], components: rows };
}

// Acepta tanto [{tierKey, role}] (recién creados, objeto Role completo) como
// [{tierKey, roleId}] (releído de rolesDraft.lastCreated tras un re-render) — la carrera
// de doble click (ver setupwizard_roles_create) necesita reconstruir la MISMA sugerencia
// a partir de lo que ya quedó guardado, sin volver a tocar Discord.
function suggestWiring(createdRoles) {
  const adminEntry = createdRoles.find(({ tierKey }) => ROLE_TIERS[tierKey].tierHint === 'admin');
  const moderatorEntry = createdRoles.find(({ tierKey }) => ROLE_TIERS[tierKey].tierHint === 'moderator');
  return {
    adminRoleId: adminEntry ? adminEntry.role?.id ?? adminEntry.roleId ?? null : null,
    moderatorRoleId: moderatorEntry ? moderatorEntry.role?.id ?? moderatorEntry.roleId ?? null : null,
  };
}

function buildRoleWiringPanel(summaryText, suggestion) {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🔗 Asignar tiers de NEXO (opcional)')
    .setDescription(
      (summaryText ? `${summaryText}\n\n` : '') +
        'Esto es DISTINTO de los permisos nativos de Discord que ya tienen los roles — acá elegís qué rol usa NEXO para dar acceso a comandos como `/warn`, `/ban` (tier Moderador) o `/economia-staff`, `/xp`, `/shop-admin` (tier Administrador). Es opcional: se puede dejar para después con `/config rol-admin`.',
    );

  const rowAdmin = new ActionRowBuilder().addComponents(
    (() => {
      const select = new RoleSelectMenuBuilder()
        .setCustomId('setupwizard_roles_admintier_select')
        .setPlaceholder('Tier Administrador de NEXO (economía/XP/shop-admin)')
        .setMinValues(0)
        .setMaxValues(1);
      if (suggestion.adminRoleId) select.setDefaultRoles(suggestion.adminRoleId);
      return select;
    })(),
  );
  const rowModerator = new ActionRowBuilder().addComponents(
    (() => {
      const select = new RoleSelectMenuBuilder()
        .setCustomId('setupwizard_roles_modtier_select')
        .setPlaceholder('Tier Moderador de NEXO (moderación día a día)')
        .setMinValues(0)
        .setMaxValues(1);
      if (suggestion.moderatorRoleId) select.setDefaultRoles(suggestion.moderatorRoleId);
      return select;
    })(),
  );
  const rowButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('setupwizard_roles_wiring_save').setLabel('✅ Guardar').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('setuphome_back').setLabel('Omitir / Volver al inicio').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [rowAdmin, rowModerator, rowButtons] };
}

// Crea los roles elegidos, uno por uno — un fallo en uno NUNCA aborta a los demás
// (Bloque 9, "resistente a errores parciales"). El reposicionamiento final es
// best-effort: si falla, los roles ya existen y están por debajo del bot (posición por
// defecto de Discord al crear), solo queda cosmético que no respeten el orden exacto
// entre sí.
async function createSelectedRoleTiers(interaction, rolesDraft) {
  const me = interaction.guild.members.me;
  if (!me || me.roles.highest.position <= 0) {
    return { results: [], createdRoles: [], fatalError: 'NEXO no tiene ningún rol propio por encima de @everyone — no puede crear roles de staff todavía.' };
  }

  const orderedKeys = ROLE_TIER_ORDER.filter((key) => rolesDraft.selectedTiers.includes(key));
  const results = [];
  const createdRoles = [];

  for (const tierKey of orderedKeys) {
    const tier = ROLE_TIERS[tierKey];
    const override = rolesDraft.overrides[tierKey] || {};
    try {
      const role = await interaction.guild.roles.create({
        name: (override.name || tier.defaultName).slice(0, 100),
        color: override.color || tier.defaultColor,
        hoist: true,
        permissions: tier.permissions,
        reason: 'Creado por /setup de NEXO (Setup Inteligente — roles de staff)',
      });
      createdRoles.push({ tierKey, role });
      results.push({ tierKey, label: tier.label, ok: true, role });
    } catch (error) {
      results.push({ tierKey, label: tier.label, ok: false, reason: describeError(error, 'Error desconocido creando el rol.').replace(/^❌\s*/, '') });
    }
  }

  if (createdRoles.length > 1) {
    try {
      const basePosition = me.roles.highest.position - 1;
      const positions = createdRoles.map(({ tierKey, role }) => ({
        role: role.id,
        position: Math.max(1, basePosition - ROLE_TIER_ORDER.indexOf(tierKey)),
      }));
      await interaction.guild.roles.setPositions(positions);
    } catch (error) {
      console.error('⚠️ No se pudo reordenar la jerarquía de los roles de staff nuevos (cosmético, no crítico):', error);
    }
  }

  return { results, createdRoles, fatalError: null };
}

registerSetupButton('setuphome_roles', async (i) => {
  const session = ensureWizardSession(i);
  await i.update(buildRoleWizardPanel(session.draft.rolesDraft));
});

registerSetupSelect('setupwizard_roles_select', async (i) => {
  const session = requireWizardSession(i);
  if (!session) return i.reply({ content: WIZARD_SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
  session.draft.rolesDraft.selectedTiers = i.values;
  refreshWizardSession(wizardKey(i.guildId, i.user.id), session.draft);
  await i.update(buildRoleWizardPanel(session.draft.rolesDraft));
});

registerSetupSelect('setupwizard_roles_edittarget_select', async (i) => {
  const session = requireWizardSession(i);
  if (!session) return i.reply({ content: WIZARD_SESSION_EXPIRED, flags: MessageFlags.Ephemeral });

  const tierKey = i.values[0];
  const tier = ROLE_TIERS[tierKey];
  if (!tier) return i.reply({ content: '❌ Rol inválido.', flags: MessageFlags.Ephemeral });

  const override = session.draft.rolesDraft.overrides[tierKey] || {};
  const modal = new ModalBuilder().setCustomId(`modal_setupwizard_roleedit_${tierKey}`).setTitle(`Editar: ${tier.label}`);
  const nameInput = new TextInputBuilder()
    .setCustomId('nombre')
    .setLabel('Nombre del rol')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(100)
    .setRequired(true)
    .setValue(override.name || tier.defaultName);
  const colorInput = new TextInputBuilder()
    .setCustomId('color')
    .setLabel('Color (hex, ej. #7F5AF0)')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(7)
    .setRequired(true)
    .setValue(override.color || tier.defaultColor);
  modal.addComponents(new ActionRowBuilder().addComponents(nameInput), new ActionRowBuilder().addComponents(colorInput));
  await i.showModal(modal);
});

registerSetupModal('modal_setupwizard_roleedit_', async (i) => {
  const session = requireWizardSession(i);
  if (!session) return i.reply({ content: WIZARD_SESSION_EXPIRED, flags: MessageFlags.Ephemeral });

  const tierKey = i.customId.slice('modal_setupwizard_roleedit_'.length);
  const tier = ROLE_TIERS[tierKey];
  if (!tier) return i.reply({ content: '❌ Rol inválido.', flags: MessageFlags.Ephemeral });

  const previous = session.draft.rolesDraft.overrides[tierKey] || {};
  const name = i.fields.getTextInputValue('nombre').trim().slice(0, 100) || tier.defaultName;
  const colorRaw = i.fields.getTextInputValue('color').trim();
  const color = isValidHexColor(colorRaw) ? normalizeHexColor(colorRaw) : previous.color || tier.defaultColor;

  session.draft.rolesDraft.overrides[tierKey] = { name, color };
  refreshWizardSession(wizardKey(i.guildId, i.user.id), session.draft);
  await i.update(buildRoleWizardPanel(session.draft.rolesDraft));
});

registerSetupButton('setupwizard_roles_create', async (i) => {
  const session = requireWizardSession(i);
  if (!session) return i.reply({ content: WIZARD_SESSION_EXPIRED, flags: MessageFlags.Ephemeral });

  if (session.draft.rolesDraft.selectedTiers.length === 0) {
    await i.update(buildRoleWiringPanel(null, {}));
    return;
  }

  await i.update({ content: '⏳ Creando roles...', embeds: [], components: [] });

  // El chequeo de "¿hay algo para crear?" se repite ACÁ ADENTRO, releyendo la sesión
  // fresca, en vez de confiar en el de arriba (que corrió ANTES de tomar el lock): dos
  // clicks casi simultáneos en "Crear" pueden entrar los dos antes de que ninguno
  // termine — sin este segundo chequeo, el segundo repetiría la creación completa de
  // los mismos roles apenas se libera el lock del primero. selectedTiers se vacía recién
  // cuando la creación termina bien, así que el segundo la ve vacía y no hace nada.
  await withLock(`setup-roles-create:${i.guildId}:${i.user.id}`, async () => {
    const freshSession = requireWizardSession(i);
    if (!freshSession) return; // sesión expiró justo en el medio — esta interacción ya quedó en "Creando..."

    if (freshSession.draft.rolesDraft.selectedTiers.length === 0) {
      // Un click anterior en carrera ya terminó de crear (o no había nada para crear) —
      // muestra el MISMO resultado final en vez de dejar esta interacción congelada en
      // "Creando roles..." para siempre.
      await i.editReply(buildRoleWiringPanel(null, suggestWiring(freshSession.draft.rolesDraft.lastCreated || [])));
      return;
    }
    const rolesDraft = freshSession.draft.rolesDraft;

    const { results, createdRoles, fatalError } = await createSelectedRoleTiers(i, rolesDraft);

    if (fatalError) {
      await i.editReply({ content: `❌ ${fatalError}`, embeds: [], components: [] });
      return;
    }

    const summaryLines = results.map((r) => (r.ok ? `✅ Creado: ${r.role}` : `❌ ${r.label}: ${r.reason}`));
    freshSession.draft.rolesDraft.lastCreated = createdRoles.map(({ tierKey, role }) => ({ tierKey, roleId: role.id }));
    freshSession.draft.rolesDraft.selectedTiers = []; // hecho — idempotente ante un segundo click en cola
    refreshWizardSession(wizardKey(i.guildId, i.user.id), freshSession.draft);

    if (createdRoles.length > 0) {
      try {
        const logChannel = await getGuildLogChannel(i.client, i.guildId, 'activity');
        if (logChannel) await logChannel.send({ embeds: [createBotConfigLogEmbed({ executor: i.user, changes: summaryLines })] });
      } catch (error) {
        console.error('⚠️ No se pudo registrar la creación de roles de staff en el canal de logs:', error);
      }
    }

    await i.editReply(buildRoleWiringPanel(summaryLines.join('\n'), suggestWiring(createdRoles)));
  });
});

registerSetupSelect('setupwizard_roles_admintier_select', async (i) => {
  const session = requireWizardSession(i);
  if (!session) return i.reply({ content: WIZARD_SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
  session.draft.rolesDraft.wiringAdminRoleId = i.values[0] || null;
  refreshWizardSession(wizardKey(i.guildId, i.user.id), session.draft);
  await i.deferUpdate();
});

registerSetupSelect('setupwizard_roles_modtier_select', async (i) => {
  const session = requireWizardSession(i);
  if (!session) return i.reply({ content: WIZARD_SESSION_EXPIRED, flags: MessageFlags.Ephemeral });
  session.draft.rolesDraft.wiringModeratorRoleId = i.values[0] || null;
  refreshWizardSession(wizardKey(i.guildId, i.user.id), session.draft);
  await i.deferUpdate();
});

registerSetupButton('setupwizard_roles_wiring_save', async (i) => {
  const session = requireWizardSession(i);
  if (!session) return i.reply({ content: WIZARD_SESSION_EXPIRED, flags: MessageFlags.Ephemeral });

  const { wiringAdminRoleId, wiringModeratorRoleId } = session.draft.rolesDraft;
  const patch = {};
  if (wiringAdminRoleId) patch.admin_role_id = wiringAdminRoleId;
  if (wiringModeratorRoleId) patch.moderator_role_id = wiringModeratorRoleId;

  if (Object.keys(patch).length > 0) {
    await setGuildConfig(i.guildId, patch);
    try {
      const logChannel = await getGuildLogChannel(i.client, i.guildId, 'activity');
      if (logChannel) {
        const lines = [];
        if (patch.admin_role_id) lines.push(`👑 Tier Administrador de NEXO → <@&${patch.admin_role_id}>`);
        if (patch.moderator_role_id) lines.push(`🔨 Tier Moderador de NEXO → <@&${patch.moderator_role_id}>`);
        await logChannel.send({ embeds: [createBotConfigLogEmbed({ executor: i.user, changes: lines })] });
      }
    } catch (error) {
      console.error('⚠️ No se pudo registrar la asignación de tiers de NEXO en el canal de logs:', error);
    }
  }

  wizardSessions.delete(wizardKey(i.guildId, i.user.id));
  const payload = await renderHome(i, i.guild, i.guildId);
  await i.update(payload);
});

// ---------- Bloques 6-9: diagnóstico de canales ----------

// Nombres legibles de los canales que NEXO conoce con certeza (los que él mismo creó o
// se le apuntó por /setup o /config) — para poder decir "revisé ESTOS" en vez de una
// frase genérica. Solo lista los que están configurados; feedback en vivo probando el
// wizard: "no se detectó ningún problema" solo no decía CONTRA QUÉ se comparó.
function describeManagedChannels(cfg) {
  const managed = [];
  if (cfg.log_channel_moderation_id) managed.push('el canal de logs de moderación');
  if (cfg.log_channel_activity_id) managed.push('el canal de logs de actividad');
  if (cfg.log_channel_economy_id) managed.push('el canal de logs de economía');
  if (cfg.welcome_channel_id) managed.push('el canal de bienvenida');
  if (cfg.confession_channel_id) managed.push('el canal de confesiones');
  return managed;
}

function buildDiagnosticsPanel(findings, cfg) {
  const problems = findings.filter((f) => f.status === STATUS.ERROR);
  const warnings = findings.filter((f) => f.status === STATUS.WARN);

  const embed = new EmbedBuilder()
    .setColor(problems.length > 0 ? LOG_COLOR : warnings.length > 0 ? GOLD_COLOR : SUCCESS_COLOR)
    .setTitle('🔎 Diagnóstico de canales y roles')
    .setFooter({ text: BRAND_NAME });

  if (findings.length === 0) {
    const managed = describeManagedChannels(cfg);
    const managedText =
      managed.length > 0
        ? `Revisé ${managed.join(', ')} — que @everyone no pueda verlos y que el rol de staff sí.`
        : 'Todavía no tenés ningún canal que NEXO gestione (logs, bienvenida, confesiones) para revisar con certeza.';
    embed.setDescription(
      `🟢 No se detectó ningún problema.\n\n${managedText}\n\nTambién repasé TODOS los demás canales del servidor (de cualquier tipo — texto, voz, categorías, foros) buscando permisos peligrosos otorgados de más a algún rol, y TODOS los roles del servidor buscando permisos peligrosos a nivel base fuera de tu rol de staff/administrador — tampoco encontré nada ahí.`,
    );
  } else {
    const channelFindings = findings.filter((f) => f.kind !== 'role');
    const roleFindings = findings.filter((f) => f.kind === 'role');
    const lines = [];
    const groups = groupFindingsByCategory(channelFindings);
    for (const [categoryName, items] of groups) {
      lines.push(`**📁 ${categoryName}**`);
      for (const f of items) lines.push(`${STATUS_EMOJI[f.status]} #${f.channelName} — ${f.summary}`);
    }
    if (roleFindings.length > 0) {
      lines.push('**👤 Roles del servidor**');
      for (const f of roleFindings) lines.push(`${STATUS_EMOJI[f.status]} @${f.roleName} — ${f.summary}`);
    }
    embed.setDescription(lines.join('\n').slice(0, 3900));
    embed.addFields({ name: 'Total', value: `${problems.length} problema(s), ${warnings.length} para revisar a mano.` });
  }

  const correctable = findings.filter((f) => f.correctable);
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setuphome_back').setLabel('⬅️ Volver').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('setuphome_diagnostics').setLabel('🔄 Reescanear').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('setupwizard_diagnostics_fix')
        .setLabel(`🛠️ Corregir ${correctable.length} problema(s)`)
        .setStyle(ButtonStyle.Danger)
        .setDisabled(correctable.length === 0),
    ),
  ];

  return { embeds: [embed], components: rows };
}

registerSetupButton('setuphome_diagnostics', async (i) => {
  const cfg = await getGuildConfig(i.guildId);
  const findings = [...scanGuildChannels(i.guild, cfg), ...scanGuildRoles(i.guild, cfg)];
  const session = ensureWizardSession(i);
  session.draft.diagnosticsFindings = findings;
  refreshWizardSession(wizardKey(i.guildId, i.user.id), session.draft);
  await i.update(buildDiagnosticsPanel(findings, cfg));
});

registerSetupButton('setupwizard_diagnostics_fix', async (i) => {
  const session = requireWizardSession(i);
  if (!session) return i.reply({ content: WIZARD_SESSION_EXPIRED, flags: MessageFlags.Ephemeral });

  const correctable = (session.draft.diagnosticsFindings || []).filter((f) => f.correctable);
  if (correctable.length === 0) return i.reply({ content: '❌ No hay nada para corregir.', flags: MessageFlags.Ephemeral });

  const description = `Se van a modificar ${correctable.length} canal(es):\n${correctable.map((f) => `• #${f.channelName} — ${f.summary}`).join('\n')}`.slice(0, 1900);

  await i.reply(
    buildConfirmation({
      userId: i.user.id,
      guildId: i.guildId,
      description,
      run: (confirmInteraction) =>
        withLock(`setup-diagnostics-fix:${confirmInteraction.guildId}:${confirmInteraction.user.id}`, async () => {
          await confirmInteraction.update({ content: '⏳ Aplicando correcciones...', embeds: [], components: [] });

          const outcomes = [];
          for (const finding of correctable) {
            const result = await applyChannelCorrection(confirmInteraction.guild, finding.correction);
            outcomes.push({ finding, result });
          }
          const ok = outcomes.filter((o) => o.result.ok);
          const failed = outcomes.filter((o) => !o.result.ok);
          const lines = [`✅ ${ok.length} cambio(s) aplicados`];
          if (failed.length > 0) {
            lines.push(`❌ ${failed.length} cambio(s) no pudieron aplicarse`);
            for (const o of failed) lines.push(`#${o.finding.channelName} — Motivo: ${o.result.reason}`);
          }
          await confirmInteraction.editReply({ content: lines.join('\n'), embeds: [], components: [] });

          if (ok.length > 0) {
            try {
              const logChannel = await getGuildLogChannel(confirmInteraction.client, confirmInteraction.guildId, 'activity');
              if (logChannel) {
                await logChannel.send({
                  embeds: [createBotConfigLogEmbed({ executor: confirmInteraction.user, changes: ok.map((o) => `🔎 Corregido: #${o.finding.channelName} — ${o.finding.summary}`) })],
                });
              }
            } catch (error) {
              console.error('⚠️ No se pudo registrar la corrección de canales en el canal de logs:', error);
            }
          }
        }),
    }),
  );
});

// ---------- Bloque 10: contador de miembros ----------

function buildCounterPanel(cfg, guild) {
  const active = Boolean(cfg.member_counter_channel_id);
  const channelExists = active && guild.channels.cache.has(cfg.member_counter_channel_id);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('👥 Contador de miembros')
    .setDescription(
      !active
        ? 'Crea un canal de voz bloqueado (nadie se puede conectar) cuyo nombre muestra la cantidad de miembros del servidor — se actualiza solo, cada 15 minutos como mucho.'
        : channelExists
          ? `Activo — <#${cfg.member_counter_channel_id}>. Se actualiza cada 15 minutos si el número cambió (Discord limita los cambios de nombre, por eso no es instantáneo).`
          : '⚠️ El canal configurado ya no existe en el servidor (¿se borró a mano?) — creá uno nuevo o desactivá el contador.',
    );

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setuphome_back').setLabel('⬅️ Volver').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('setupwizard_counter_create').setLabel(active ? '♻️ Recrear' : '🆕 Crear').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('setupwizard_counter_disable').setLabel('🗑️ Desactivar').setStyle(ButtonStyle.Danger).setDisabled(!active),
    ),
  ];

  return { embeds: [embed], components: rows };
}

registerSetupButton('setuphome_counter', async (i) => {
  const cfg = await getGuildConfig(i.guildId);
  await i.update(buildCounterPanel(cfg, i.guild));
});

registerSetupButton('setupwizard_counter_create', async (i) => {
  await withLock(`setup-counter:${i.guildId}:${i.user.id}`, async () => {
    await i.update({ content: '⏳ Configurando el contador...', embeds: [], components: [] });
    const cfg = await getGuildConfig(i.guildId);
    try {
      const { category } = await resolveCategory(i, cfg);
      const initialName = buildCounterChannelName(i.guild.memberCount);
      const { channel, created } = await resolveChannel(i, cfg, category, {
        column: 'member_counter_channel_id',
        name: initialName,
        type: ChannelType.GuildVoice,
        overwrites: [
          { id: i.guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.Connect] },
        ],
      });
      await setGuildConfig(i.guildId, {
        member_counter_channel_id: channel.id,
        member_counter_last_count: i.guild.memberCount,
        setup_category_id: category?.id ?? cfg.setup_category_id ?? null,
      });
      if (!created) await syncMemberCounterForGuild(i.guild).catch(() => {});
      const refreshedCfg = await getGuildConfig(i.guildId);
      await i.editReply(buildCounterPanel(refreshedCfg, i.guild));
    } catch (error) {
      await i.editReply({ content: describeError(error, '❌ No se pudo crear el canal del contador.'), embeds: [], components: [] });
    }
  });
});

registerSetupButton('setupwizard_counter_disable', async (i) => {
  await setGuildConfig(i.guildId, { member_counter_channel_id: null, member_counter_last_count: null });
  const cfg = await getGuildConfig(i.guildId);
  await i.update(buildCounterPanel(cfg, i.guild));
});

// ---------- Bloques 11-12: editor de bienvenida ----------

function buildWelcomeEditorPanel(cfg, welcomeDraft, ctx) {
  const merged = { ...cfg, ...welcomeDraft };
  const preview = buildWelcomePreviewEmbed(merged, ctx);

  const metaEmbed = new EmbedBuilder()
    .setColor(NEUTRAL_COLOR)
    .setTitle('🎉 Editor de bienvenida — vista previa abajo')
    .setDescription(
      'Variables disponibles en título/descripción/footer: `{servidor}` `{usuario}` `{usuarioNombre}` `{miembroNumero}`.\n\n' +
        (cfg.welcome_channel_id ? `Canal actual: <#${cfg.welcome_channel_id}>` : '⚠️ Todavía no hay canal de bienvenida — creá uno con el botón de abajo.'),
    );

  const hasChanges = Object.keys(welcomeDraft).length > 0;
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setuphome_back').setLabel('⬅️ Volver').setStyle(ButtonStyle.Secondary),
      // El selector de emoji vive DENTRO del modal de "✏️ Editar" (ver
      // setupwizard_welcome_edit) — pedido explícito en vivo, no un botón aparte.
      new ButtonBuilder().setCustomId('setupwizard_welcome_edit').setLabel('✏️ Editar').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('setupwizard_welcome_channel')
        .setLabel(cfg.welcome_channel_id ? '♻️ Recrear canal' : '🆕 Crear canal')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('setupwizard_welcome_save').setLabel('✅ Guardar').setStyle(ButtonStyle.Success).setDisabled(!hasChanges),
    ),
  ];

  return { embeds: [metaEmbed, preview], components: rows };
}

registerSetupButton('setuphome_welcome', async (i) => {
  const session = ensureWizardSession(i);
  const cfg = await getGuildConfig(i.guildId);
  await i.update(buildWelcomeEditorPanel(cfg, session.draft.welcomeDraft, contextFromInteraction(i)));
});

// Feedback en vivo probando el editor: el selector de emoji tenía que aparecer DENTRO
// de esta misma pantalla de edición, no como un botón aparte (ver el diseño original,
// descartado). Components V2 (LabelBuilder + StringSelectMenu con búsqueda nativa,
// mismo patrón que /rolreacciones) SÍ puede convivir con los TextInput clásicos en el
// MISMO modal — confirmado leyendo el validador real de @discordjs/builders
// (componentsValidator acepta ActionRowBuilder o LabelBuilder mezclados en el mismo
// array, no exige un solo estilo), no adivinado. Ocupa la 5ta fila — el máximo real de
// un modal es 5, así que con los 4 campos de texto de siempre no queda lugar para nada
// más. minValues 0: dejarlo sin tocar sigue guardando el texto igual que antes.
registerSetupButton('setupwizard_welcome_edit', async (i) => {
  const session = requireWizardSession(i);
  if (!session) return i.reply({ content: WIZARD_SESSION_EXPIRED, flags: MessageFlags.Ephemeral });

  const cfg = await getGuildConfig(i.guildId);
  const draft = session.draft.welcomeDraft;

  const modal = new ModalBuilder().setCustomId('modal_setupwizard_welcometext').setTitle('Editor de bienvenida');
  const titleInput = new TextInputBuilder()
    .setCustomId('titulo')
    .setLabel('Título')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(256)
    .setRequired(false)
    .setValue((draft.welcome_title ?? cfg.welcome_title) || DEFAULT_WELCOME_TITLE);
  const descriptionInput = new TextInputBuilder()
    .setCustomId('descripcion')
    .setLabel('Descripción (se agrega el hint de /help solo)')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(3500)
    .setRequired(false)
    .setValue((draft.welcome_description ?? cfg.welcome_description) || DEFAULT_WELCOME_DESCRIPTION);
  const colorInput = new TextInputBuilder()
    .setCustomId('color')
    .setLabel('Color (hex, opcional)')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(7)
    .setRequired(false)
    .setValue((draft.welcome_color ?? cfg.welcome_color) || '');
  const footerInput = new TextInputBuilder()
    .setCustomId('footer')
    .setLabel('Footer (opcional)')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(2048)
    .setRequired(false)
    .setValue((draft.welcome_footer ?? cfg.welcome_footer) || '');

  modal.addComponents(
    new ActionRowBuilder().addComponents(titleInput),
    new ActionRowBuilder().addComponents(descriptionInput),
    new ActionRowBuilder().addComponents(colorInput),
    new ActionRowBuilder().addComponents(footerInput),
  );

  // .fetch(), nunca .cache a secas — el bot no tiene el intent GuildEmojisAndStickers,
  // el cache de gateway puede estar desactualizado (mismo gotcha ya documentado para el
  // selector de /rolreacciones). Sin emojis propios: el modal queda con los 4 campos de
  // siempre, sin selector — Discord exige al menos 1 opción, no se puede mostrar vacío.
  const guildEmojis = [...(await i.guild.emojis.fetch().catch(() => i.guild.emojis.cache)).values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 25);

  if (guildEmojis.length > 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId('welcome_emoji_pick')
      .setMinValues(0)
      .setMaxValues(1)
      // Reventó en producción (DiscordAPIError 50035, COMPONENT_REQUIRED_ZERO_MIN_VALUES):
      // un select DENTRO de un modal es "required" por defecto — eso es un concepto
      // SEPARADO de minValues, expuesto por BaseSelectMenuBuilder.setRequired() ("Only
      // for use in modals", confirmado leyendo el .d.ts de @discordjs/builders). Sin
      // esto, Discord rechaza la combinación "required + minValues 0" como contradictoria
      // — no lo agarra ningún validador cliente, es un chequeo 100% del lado del servidor.
      .setRequired(false)
      .addOptions(
        guildEmojis.map((emoji) =>
          new StringSelectMenuOptionBuilder().setLabel(emoji.name.slice(0, 100)).setValue(emoji.id).setEmoji({ id: emoji.id, name: emoji.name, animated: emoji.animated }),
        ),
      );
    // LabelBuilder.setLabel tiene el MISMO límite real de 45 caracteres que
    // TextInputBuilder.setLabel — reventó en producción una vez con un texto de 66
    // chars, porque node --check y un showModal mockeado nunca ejercitan el .toJSON()
    // real que discord.js usa para validar esto.
    const label = new LabelBuilder().setLabel('Emoji (opcional, va al final del texto)').setStringSelectMenuComponent(select);
    modal.addLabelComponents(label);
  }

  await i.showModal(modal);
});

registerSetupModal('modal_setupwizard_welcometext', async (i) => {
  const session = requireWizardSession(i);
  if (!session) return i.reply({ content: WIZARD_SESSION_EXPIRED, flags: MessageFlags.Ephemeral });

  const titulo = i.fields.getTextInputValue('titulo').trim();
  let descripcion = i.fields.getTextInputValue('descripcion').trim();
  const colorRaw = i.fields.getTextInputValue('color').trim();
  const footer = i.fields.getTextInputValue('footer').trim();

  // El selector de emoji es opcional Y solo existe en el modal si el servidor tenía
  // emojis propios (ver arriba) — getStringSelectValues tira si el customId no estaba
  // en ESTE modal en absoluto, así que se envuelve en try/catch en vez de asumir que
  // siempre está. Si el selector SÍ estaba pero no se tocó (minValues 0), devuelve un
  // array vacío sin tirar — pickedEmojiId queda undefined y no pasa nada.
  let pickedEmojiId;
  try {
    [pickedEmojiId] = i.fields.getStringSelectValues('welcome_emoji_pick');
  } catch {
    pickedEmojiId = undefined;
  }
  if (pickedEmojiId) {
    const emoji = i.guild.emojis.cache.get(pickedEmojiId);
    if (emoji) descripcion = `${descripcion} ${emoji.toString()}`.trim();
  }

  session.draft.welcomeDraft.welcome_title = titulo || null;
  session.draft.welcomeDraft.welcome_description = descripcion || null;
  session.draft.welcomeDraft.welcome_color = colorRaw && isValidHexColor(colorRaw) ? normalizeHexColor(colorRaw) : null;
  session.draft.welcomeDraft.welcome_footer = footer || null;
  refreshWizardSession(wizardKey(i.guildId, i.user.id), session.draft);

  const cfg = await getGuildConfig(i.guildId);
  await i.update(buildWelcomeEditorPanel(cfg, session.draft.welcomeDraft, contextFromInteraction(i)));
});

registerSetupButton('setupwizard_welcome_channel', async (i) => {
  await withLock(`setup-welcome-channel:${i.guildId}:${i.user.id}`, async () => {
    const session = requireWizardSession(i);
    if (!session) return i.reply({ content: WIZARD_SESSION_EXPIRED, flags: MessageFlags.Ephemeral });

    await i.update({ content: '⏳ Configurando el canal de bienvenida...', embeds: [], components: [] });
    const cfg = await getGuildConfig(i.guildId);
    try {
      const { category } = await resolveCategory(i, cfg);
      const { channel } = await resolveChannel(i, cfg, category, {
        column: 'welcome_channel_id',
        name: 'bienvenida',
        overwrites: [{ id: i.guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel] }],
      });
      await setGuildConfig(i.guildId, { welcome_channel_id: channel.id, setup_category_id: category?.id ?? cfg.setup_category_id ?? null });
      const refreshedCfg = await getGuildConfig(i.guildId);
      await i.editReply(buildWelcomeEditorPanel(refreshedCfg, session.draft.welcomeDraft, contextFromInteraction(i)));
    } catch (error) {
      await i.editReply({ content: describeError(error, '❌ No se pudo crear/verificar el canal de bienvenida.'), embeds: [], components: [] });
    }
  });
});

registerSetupButton('setupwizard_welcome_save', async (i) => {
  const session = requireWizardSession(i);
  if (!session) return i.reply({ content: WIZARD_SESSION_EXPIRED, flags: MessageFlags.Ephemeral });

  const patch = {};
  for (const field of ['welcome_title', 'welcome_description', 'welcome_color', 'welcome_footer']) {
    if (field in session.draft.welcomeDraft) patch[field] = session.draft.welcomeDraft[field];
  }

  if (Object.keys(patch).length > 0) {
    await setGuildConfig(i.guildId, patch);
    try {
      const logChannel = await getGuildLogChannel(i.client, i.guildId, 'activity');
      if (logChannel) await logChannel.send({ embeds: [createBotConfigLogEmbed({ executor: i.user, changes: ['🎉 Bienvenida personalizada (texto/color)'] })] });
    } catch (error) {
      console.error('⚠️ No se pudo registrar el cambio de bienvenida en el canal de logs:', error);
    }
  }

  session.draft.welcomeDraft = {};
  refreshWizardSession(wizardKey(i.guildId, i.user.id), session.draft);
  const payload = await renderHome(i, i.guild, i.guildId);
  await i.update(payload);
});

// ---------- Bloques 13-14: economía y casino ----------

async function buildEconomyPanel(guildId) {
  const custom = await hasCustomShopItems(guildId);

  const embed = new EmbedBuilder()
    .setColor(GOLD_COLOR)
    .setTitle('💰 Economía y Casino')
    .addFields(
      {
        name: `${custom ? '🟢' : '🟡'} Tienda`,
        value: custom
          ? 'Este servidor tiene su propio catálogo — `/shop` muestra tus ítems.'
          : '`/shop` está usando el catálogo de ejemplo genérico — funciona igual, pero personalizarlo con `/shop-admin agregar` hace que la economía se sienta propia de este servidor.',
      },
      {
        name: '🟢 Rangos de /daily /work /crime /rob',
        value: 'Usan los valores por defecto de NEXO salvo que los personalices con `/config economia` — nunca bloquean nada, son opcionales.',
      },
      {
        name: '🟢 Casino (/coinflip /dado /slots /ruleta)',
        value: 'No depende de ninguna configuración por-servidor — funciona igual en cualquier NEXO, sin pasos previos.',
      },
    )
    .setFooter({ text: 'Editar: /shop-admin (tienda) · /config economia (rangos y probabilidades)' });

  const rows = [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setuphome_back').setLabel('⬅️ Volver').setStyle(ButtonStyle.Secondary))];
  return { embeds: [embed], components: rows };
}

registerSetupButton('setuphome_economy', async (i) => {
  await i.update(await buildEconomyPanel(i.guildId));
});
