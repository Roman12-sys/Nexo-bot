import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import { BRAND_COLOR, BRAND_NAME, GOLD_COLOR, EMERALD_COLOR, INDIGO_COLOR, MAGENTA_COLOR } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import { ESSENTIAL_BOT_PERMISSIONS } from '../../utils/botPermissions.js';
import { registerButtonPrefix } from '../../components/buttons.js';

// Auditoría UX/UI (2026-09-18), hallazgo Importante "/helpstaff no distingue acciones
// Tier 2/peligrosas": el puente hacia /staff (el panel visual equivalente) solo existía
// dentro de /setup (una sola vez, al instalar) y en el footer de /config ver — nunca acá,
// que es el punto de entrada real donde el staff busca ayuda del día a día.
export function buildMainMenuEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🛠️ Comandos de staff')
    .setDescription(
      'Elegí una categoría tocando un botón de abajo para ver sus comandos. Los botones de acceso rápido abren directamente los más usados.\n\n' +
        'El panel visual equivalente para configurar todo esto es `/staff`.',
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();
}

export function buildMainMenuRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('helpstaff_cat_moderacion').setLabel('🧹 Moderación').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('helpstaff_cat_advertencias').setLabel('⚠️ Advertencias y sanciones').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('helpstaff_cat_sorteos').setLabel('📢 Sorteos y anuncios').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('helpstaff_cat_economia').setLabel('💰 Economía').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('helpstaff_cat_roles').setLabel('🎭 Roles').setStyle(ButtonStyle.Secondary),
  );
}

export function buildMainMenuRow2() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('helpstaff_cat_administracion').setLabel('⚙️ Administración').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('helpstaff_cat_xp').setLabel('⭐ XP y niveles').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('helpstaff_cat_bot').setLabel('🩺 Bot').setStyle(ButtonStyle.Secondary),
  );
}

export function buildBackRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('helpstaff_back').setLabel('🔙 Volver al menú').setStyle(ButtonStyle.Secondary),
  );
}

// QUÉ CAMBIÓ: categoría nueva — /setup y /config no aparecían en NINGÚN lugar de
// /helpstaff, así que un admin nuevo no tenía forma de descubrirlos desde el propio
// bot (tenía que ya saber que existen). Son las dos entradas fundamentales de todo el
// modelo de configuración de Nexo (ver guild_config en CLAUDE.md) — se resumen por
// tema en vez de listar las ~15 subcommands de /config una por una, para no convertir
// esto en una enciclopedia.
// MOTIVO: auditoría Fase 2B, sección 9.
// Auditoría UX/UI (2026-09-18), formato de comandos: campo por comando → lista agrupada
// con el comando en `código` (mismo estilo que ya tenía "🟢 Cualquier staff" más abajo),
// unificado en TODAS las categorías de /help y /helpstaff.
export function buildAdministracionEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('⚙️ Administración')
    .setDescription('Configuración del servidor — separado de "Moderación" (sanciones del día a día).')
    .addFields(
      {
        name: '🚀 Setup y config',
        value: [
          '`/setup` — Configuración inicial guiada: elegí una plantilla, activá módulos (moderación/economía/XP) y extras opcionales (bienvenida, confesiones, rol automático, rol de castigo). Crea los canales/roles que falten. Se puede volver a correr sin duplicar nada.',
          '`/config ver` — Resumen completo de la configuración actual (todo lo que dejó armado /setup, más lo que se haya tocado después).',
          '`/config exportar` — Descarga un JSON de respaldo de toda la configuración (solo lectura, no cambia nada).',
        ].join('\n'),
      },
      {
        name: '🔐 Roles y permisos',
        value: [
          '`/config rol-admin` — Separa el rol de Administrador del de Moderador (por defecto son el mismo). Solo el rol de Administrador puede usar /economia-staff y /xp — el de Moderador conserva toda la moderación normal.',
          '`/config rol-autoasignable-agregar / rol-autoasignable-quitar` — Elegí qué roles pueden elegir solos los miembros (hasta 25). Se ofrecen desde `/help` ("Mis roles") y desde el mensaje de bienvenida — nunca un rol con permisos peligrosos.',
        ].join('\n'),
      },
      {
        name: '🔔 Canales, extras y XP',
        value: [
          '`/config rol-castigo / rol-automatico / canal-bienvenida / canal-confesiones / ...` — Apuntá a un rol/canal que YA existe en el server en vez de crear uno nuevo con /setup.',
          '`/config rol-nivel / modo-roles-nivel / xp-finde-boost / xp-canal-ignorar / xp-canal-permitir` — Ajustes finos del sistema de XP y niveles.',
          '`/config confesiones-revision / confesion-bloquear / confesion-desbloquear` — Controles del sistema de confesiones anónimas.',
        ].join('\n'),
      },
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();
}

// Auditoría UX/UI (2026-09-18), hallazgo Importante "/helpstaff no distingue Tier 2":
// esta era la única categoría con un comando Tier 2 (/say) mezclado campo-a-campo con
// Tier 1, con el límite de permiso escondido en el texto de un solo campo en vez de ser
// una estructura visual. Separado en dos campos, mismo criterio que el resto de esta
// auditoría: nunca un marcador solo textual para algo que se puede estructurar.
export function buildModeracionEmbed() {
  return new EmbedBuilder()
    .setColor(INDIGO_COLOR)
    .setTitle('🧹 Moderación')
    .addFields(
      {
        name: '🟢 Cualquier staff',
        value: [
          '`/clear <cantidad>` — Elimina mensajes del canal (1-100).',
          '`/lock` — Bloquea el canal actual para que @everyone no pueda escribir.',
          '`/unlock` — Desbloquea el canal actual.',
          '`/kick <usuario>` — Expulsa a un usuario del servidor.',
          '`/ban <usuario>` — Banea a un usuario del servidor.',
          '`/timeout <usuario> <duración>` — Silencia temporalmente a un usuario.',
          '`/voice setup/config/disable/admin` — Configura las salas de voz temporales (Join to Create) y administra las salas activas.',
        ].join('\n'),
      },
      {
        name: '🔒 Solo Administrador',
        value: '`/say <mensaje>` — El bot manda un mensaje por vos en el canal actual (puede mencionar @everyone/roles/usuarios). Un Moderador no puede usarlo.',
      },
      {
        name: '🔐 Detección de secretos (automática, sin comando)',
        value: 'El bot borra solo cualquier mensaje que parezca un token de Discord, API key, JWT o línea de `.env` pegada por error, y avisa por DM a quien lo mandó para que lo rote.',
      },
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();
}

export function buildAdvertenciasEmbed() {
  return new EmbedBuilder()
    .setColor(INDIGO_COLOR)
    .setTitle('⚠️ Advertencias y sanciones')
    .addFields({
      name: '📋 Comandos',
      value: [
        '`/warn <usuario> <motivo>` — Aplica una advertencia a un usuario.',
        '`/warn-editar <usuario> <número> <motivo>` — Corrige el motivo de una advertencia ya aplicada, sin perder la fecha original.',
        '`/warns <usuario>` — Muestra las advertencias de un usuario.',
        '`/unwarn <usuario> [número]` — Quita una advertencia (o todas si no se indica número).',
        '`/punish <usuario>` — Impide que un usuario envíe imágenes o enlaces (requiere `/config rol-castigo`).',
        '`/unpunish <usuario>` — Quita esa restricción.',
        '`/unban <usuario>` — Desbanea directamente (con autocompletado de baneados), sin pasar por el panel.',
        '`/sanciones` — Panel para ver y quitar timeouts, restricciones, baneos y advertencias activas.',
      ].join('\n'),
    })
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();
}

export function buildSorteosAnunciosEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('📢 Sorteos y anuncios')
    .addFields({
      name: '📋 Comandos',
      value: [
        '`/sorteo crear/terminar/reroll/cancelar` — Sistema de sorteos con botón de participación (con rol requerido opcional).',
        '`/anuncio` — Abre el formulario para crear un anuncio profesional (con opción de mencionar rol/usuario/@everyone).',
      ].join('\n'),
    })
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();
}

// Categoría entera Tier 2 (nunca hay comandos Tier 1 acá que separar campo-a-campo) —
// el marcador va en la descripción para que se vea ANTES de leer cada campo.
export function buildEconomiaEmbed() {
  return new EmbedBuilder()
    .setColor(EMERALD_COLOR)
    .setTitle('💰 Economía (staff)')
    .setDescription('🔒 Todo este panel requiere el rol de Administrador (`/config rol-admin`) — un Moderador no puede usar estos comandos.')
    .addFields({
      name: '📋 Comandos',
      value: [
        '`/economia-staff balance <usuario>` — Ver el balance de cualquiera.',
        '`/economia-staff agregar <usuario> <cantidad> [motivo]` — Agrega monedas.',
        '`/economia-staff quitar <usuario> <cantidad> [motivo]` — Quita monedas.',
        '`/economia-staff establecer <usuario> <cantidad> [motivo]` — Fija un balance exacto.',
        '`/economia-staff historial <usuario> [cantidad]` — Últimos movimientos: tipo, monto, balance resultante, quién lo causó y motivo.',
        '`/economia-staff perfil <usuario>` — Balance + cooldowns de /daily y /work + inventario, todo junto.',
        '`/economia-staff pendientes` — Compras pendientes de ítems de entrega manual (cambio de apodo, etc.) — se pueden marcar como entregadas desde el mismo panel.',
        '`/shop-admin agregar/editar/quitar/listar` — Arma el catálogo de /shop propio de este servidor. "editar" corrige un ítem sin romper el inventario de quien ya lo compró. "agregar" admite un tipo especial (impulso de XP o caja misteriosa) además del ítem normal.',
      ].join('\n'),
    })
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();
}

export function buildRolesEmbed() {
  return new EmbedBuilder()
    .setColor(MAGENTA_COLOR)
    .setTitle('🎭 Roles')
    .addFields({ name: '📋 Comandos', value: '`/roles` — Lista todos los roles del servidor, agrupados por categoría, con su cantidad de miembros.' })
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();
}

// Misma razón que buildEconomiaEmbed: categoría entera Tier 2, marcador en la descripción.
export function buildXpEmbed() {
  return new EmbedBuilder()
    .setColor(GOLD_COLOR)
    .setTitle('⭐ XP y niveles (staff)')
    .setDescription('🔒 Todo este panel requiere el rol de Administrador (`/config rol-admin`) — un Moderador no puede usar estos comandos.')
    .addFields({
      name: '📋 Comandos',
      value: [
        '`/xp agregar <usuario> <cantidad> [motivo]` — Agrega XP. Si el usuario sube de nivel, se procesan roles automáticos, anuncio y log igual que si lo hubiera ganado jugando.',
        '`/xp quitar <usuario> <cantidad> [motivo]` — Quita XP.',
        '`/xp establecer <usuario> <cantidad> [motivo]` — Fija la XP total exacta.',
        '`/xp nivel <usuario> <nivel> [motivo]` — Fija el nivel exacto (calcula la XP correspondiente automáticamente).',
      ].join('\n'),
    })
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();
}

export function buildBotEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🩺 Bot')
    .addFields(
      {
        name: '📋 Comandos',
        value: [
          '`/estado` — Salud técnica: latencia del gateway, conexión a Supabase, sorteos y salas de voz temporales activas en este servidor.',
          '`/metricas` — Los comandos más usados de este servidor y cuántas veces se usaron en total.',
        ].join('\n'),
      },
      {
        name: '🔍 Auditoría de configuración (automática, sin comando)',
        value: 'Cada cambio hecho con `/setup` o `/config` queda registrado en el canal de logs de actividad — quién lo cambió y qué. No solo se audita a los usuarios, también al propio bot.',
      },
      {
        name: '🎮 Patch notes de League of Legends (opcional)',
        value: 'Activalo con `/config canal-lol` — el bot avisa solo en ese canal cada vez que sale un patch nuevo, con un monitor aparte que detecta si el scraper se rompió. Apagado por defecto, no afecta a servidores que no lo usen.',
      },
      {
        name: '🔐 Permisos esenciales del bot',
        value: `${ESSENTIAL_BOT_PERMISSIONS.map((p) => p.label).join(', ')}.\n\`/estado\` avisa si al bot le falta alguno de estos — corregilo en *Ajustes del servidor → Roles* → el rol de Nexo Bot.`,
      },
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();
}

export const data = new SlashCommandBuilder()
  .setName('helpstaff')
  .setDescription('Muestra los comandos disponibles para el staff/administración.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!(await isStaff(interaction))) {
    await interaction.reply({ content: '❌ No tenés permisos para usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({
    embeds: [buildMainMenuEmbed()],
    components: [buildMainMenuRow(), buildMainMenuRow2()],
    flags: MessageFlags.Ephemeral,
  });
}

registerButtonPrefix('helpstaff_cat_administracion', async (i) => {
  if (!(await isStaff(i))) return i.reply({ content: '❌ No tenés permisos.', flags: MessageFlags.Ephemeral });
  await i.update({ embeds: [buildAdministracionEmbed()], components: [buildBackRow()] });
});
registerButtonPrefix('helpstaff_cat_moderacion', async (i) => {
  if (!(await isStaff(i))) return i.reply({ content: '❌ No tenés permisos.', flags: MessageFlags.Ephemeral });
  await i.update({ embeds: [buildModeracionEmbed()], components: [buildBackRow()] });
});
registerButtonPrefix('helpstaff_cat_advertencias', async (i) => {
  if (!(await isStaff(i))) return i.reply({ content: '❌ No tenés permisos.', flags: MessageFlags.Ephemeral });
  await i.update({ embeds: [buildAdvertenciasEmbed()], components: [buildBackRow()] });
});
registerButtonPrefix('helpstaff_cat_sorteos', async (i) => {
  if (!(await isStaff(i))) return i.reply({ content: '❌ No tenés permisos.', flags: MessageFlags.Ephemeral });
  await i.update({ embeds: [buildSorteosAnunciosEmbed()], components: [buildBackRow()] });
});
registerButtonPrefix('helpstaff_cat_economia', async (i) => {
  if (!(await isStaff(i))) return i.reply({ content: '❌ No tenés permisos.', flags: MessageFlags.Ephemeral });
  await i.update({ embeds: [buildEconomiaEmbed()], components: [buildBackRow()] });
});
registerButtonPrefix('helpstaff_cat_roles', async (i) => {
  if (!(await isStaff(i))) return i.reply({ content: '❌ No tenés permisos.', flags: MessageFlags.Ephemeral });
  await i.update({ embeds: [buildRolesEmbed()], components: [buildBackRow()] });
});
registerButtonPrefix('helpstaff_cat_xp', async (i) => {
  if (!(await isStaff(i))) return i.reply({ content: '❌ No tenés permisos.', flags: MessageFlags.Ephemeral });
  await i.update({ embeds: [buildXpEmbed()], components: [buildBackRow()] });
});
registerButtonPrefix('helpstaff_cat_bot', async (i) => {
  if (!(await isStaff(i))) return i.reply({ content: '❌ No tenés permisos.', flags: MessageFlags.Ephemeral });
  await i.update({ embeds: [buildBotEmbed()], components: [buildBackRow()] });
});
registerButtonPrefix('helpstaff_back', async (i) => {
  await i.update({ embeds: [buildMainMenuEmbed()], components: [buildMainMenuRow(), buildMainMenuRow2()] });
});
