import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import { registerButtonPrefix } from '../../components/buttons.js';
import { registerModalPrefix } from '../../components/modals.js';
import { runClear } from '../moderacion/clear.js';
import { startBuilder as startAnuncioBuilder } from '../anuncios/anuncio.js';

function buildClearModal() {
  const modal = new ModalBuilder().setCustomId('modal_helpstaff_clear').setTitle('Limpiar mensajes');
  const cantidadInput = new TextInputBuilder()
    .setCustomId('cantidad')
    .setLabel('¿Cuántos mensajes eliminar? (1-100)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Ej: 20')
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(cantidadInput));
  return modal;
}

export function getHelpStaffButtonsRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('helpstaff_clear').setLabel('🧹 Limpiar mensajes').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('helpstaff_anuncio').setLabel('📢 Crear anuncio').setStyle(ButtonStyle.Primary),
  );
}

export function buildMainMenuEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🛠️ Comandos de staff')
    .setDescription('Elegí una categoría tocando un botón de abajo para ver sus comandos. Los botones de acceso rápido abren directamente los más usados.')
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
export function buildAdministracionEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('⚙️ Administración')
    .setDescription('Configuración del servidor — separado de "Moderación" (sanciones del día a día).')
    .addFields(
      {
        name: '/setup',
        value:
          'Configuración inicial guiada: elegí una plantilla, activá módulos (moderación/economía/XP) y extras opcionales (bienvenida, confesiones, rol automático, rol de castigo). Crea los canales/roles que falten. Se puede volver a correr sin duplicar nada.',
      },
      { name: '/config ver', value: 'Resumen completo de la configuración actual (todo lo que dejó armado /setup, más lo que se haya tocado después).' },
      {
        name: '/config rol-castigo / rol-automatico / canal-bienvenida / canal-confesiones / ...',
        value: 'Apuntá a un rol/canal que YA existe en el server en vez de crear uno nuevo con /setup.',
      },
      {
        name: '/config rol-nivel / modo-roles-nivel / xp-finde-boost / xp-canal-ignorar / xp-canal-permitir',
        value: 'Ajustes finos del sistema de XP y niveles.',
      },
      { name: '/config confesiones-revision / confesion-bloquear / confesion-desbloquear', value: 'Controles del sistema de confesiones anónimas.' },
      { name: '/config exportar', value: 'Descarga un JSON de respaldo de toda la configuración (solo lectura, no cambia nada).' },
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();
}

export function buildModeracionEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🧹 Moderación')
    .addFields(
      { name: '/clear <cantidad>', value: 'Elimina mensajes del canal (1-100).' },
      { name: '/lock', value: 'Bloquea el canal actual para que @everyone no pueda escribir.' },
      { name: '/unlock', value: 'Desbloquea el canal actual.' },
      { name: '/kick <usuario>', value: 'Expulsa a un usuario del servidor.' },
      { name: '/ban <usuario>', value: 'Banea a un usuario del servidor.' },
      { name: '/timeout <usuario> <duración>', value: 'Silencia temporalmente a un usuario.' },
      { name: '/say <mensaje>', value: 'El bot manda un mensaje por vos en el canal actual.' },
      { name: '/voice setup/config/disable/admin', value: 'Configura el sistema de salas de voz temporales (Join to Create) y administra las salas activas.' },
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
    .setColor(BRAND_COLOR)
    .setTitle('⚠️ Advertencias y sanciones')
    .addFields(
      { name: '/warn <usuario> <motivo>', value: 'Aplica una advertencia a un usuario.' },
      { name: '/warn-editar <usuario> <número> <motivo>', value: 'Corrige el motivo de una advertencia ya aplicada, sin perder la fecha original.' },
      { name: '/warns <usuario>', value: 'Muestra las advertencias de un usuario.' },
      { name: '/unwarn <usuario> [número]', value: 'Quita una advertencia (o todas si no se indica número).' },
      { name: '/punish <usuario>', value: 'Impide que un usuario envíe imágenes o enlaces (requiere `/config rol-castigo`).' },
      { name: '/unpunish <usuario>', value: 'Quita esa restricción.' },
      { name: '/unban <usuario>', value: 'Desbanea directamente (con autocompletado de baneados), sin pasar por el panel.' },
      { name: '/sanciones', value: 'Panel para ver y quitar timeouts, restricciones, baneos y advertencias activas.' },
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();
}

export function buildSorteosAnunciosEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('📢 Sorteos y anuncios')
    .addFields(
      { name: '/sorteo crear/terminar/reroll/cancelar', value: 'Sistema de sorteos con botón de participación (con rol requerido opcional).' },
      { name: '/anuncio', value: 'Abre el formulario para crear un anuncio profesional (con opción de mencionar rol/usuario/@everyone).' },
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();
}

export function buildEconomiaEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('💰 Economía (staff)')
    .addFields(
      { name: '/economia-staff balance <usuario>', value: 'Ver el balance de cualquiera.' },
      { name: '/economia-staff agregar <usuario> <cantidad> [motivo]', value: 'Agrega monedas.' },
      { name: '/economia-staff quitar <usuario> <cantidad> [motivo]', value: 'Quita monedas.' },
      { name: '/economia-staff establecer <usuario> <cantidad> [motivo]', value: 'Fija un balance exacto.' },
      { name: '/economia-staff historial <usuario> [cantidad]', value: 'Últimos movimientos: tipo, monto, balance resultante, quién lo causó y motivo.' },
      { name: '/economia-staff perfil <usuario>', value: 'Balance + cooldowns de /daily y /work + inventario, todo junto.' },
      { name: '/economia-staff pendientes', value: 'Compras pendientes de ítems de entrega manual (cambio de apodo, etc.) — se pueden marcar como entregadas desde el mismo panel.' },
      { name: '/shop-admin agregar/editar/quitar/listar', value: 'Arma el catálogo de /shop propio de este servidor. "editar" corrige un ítem sin romper el inventario de quien ya lo compró. "agregar" admite un tipo especial (impulso de XP o caja misteriosa) además del ítem normal.' },
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();
}

export function buildRolesEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🎭 Roles')
    .addFields({ name: '/roles', value: 'Lista todos los roles del servidor, agrupados por categoría, con su cantidad de miembros.' })
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();
}

export function buildXpEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('⭐ XP y niveles (staff)')
    .addFields(
      { name: '/xp agregar <usuario> <cantidad> [motivo]', value: 'Agrega XP. Si el usuario sube de nivel, se procesan roles automáticos, anuncio y log igual que si lo hubiera ganado jugando.' },
      { name: '/xp quitar <usuario> <cantidad> [motivo]', value: 'Quita XP.' },
      { name: '/xp establecer <usuario> <cantidad> [motivo]', value: 'Fija la XP total exacta.' },
      { name: '/xp nivel <usuario> <nivel> [motivo]', value: 'Fija el nivel exacto (calcula la XP correspondiente automáticamente).' },
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();
}

export function buildBotEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🩺 Bot')
    .addFields(
      { name: '/estado', value: 'Salud técnica: latencia del gateway, conexión a Supabase, sorteos y salas de voz temporales activas en este servidor.' },
      { name: '/metricas', value: 'Los comandos más usados de este servidor y cuántas veces se usaron en total.' },
      {
        name: '🔍 Auditoría de configuración (automática, sin comando)',
        value: 'Cada cambio hecho con `/setup` o `/config` queda registrado en el canal de logs de actividad — quién lo cambió y qué. No solo se audita a los usuarios, también al propio bot.',
      },
      {
        name: '🎮 Patch notes de League of Legends (opcional)',
        value: 'Activalo con `/config canal-lol` — el bot avisa solo en ese canal cada vez que sale un patch nuevo, con un monitor aparte que detecta si el scraper se rompió. Apagado por defecto, no afecta a servidores que no lo usen.',
      },
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();
}

export const data = new SlashCommandBuilder()
  .setName('helpstaff')
  .setDescription('Muestra los comandos disponibles para el staff/administración.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!(await isStaff(interaction))) {
    await interaction.reply({ content: '❌ No tenés permisos para usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({
    embeds: [buildMainMenuEmbed()],
    components: [buildMainMenuRow(), buildMainMenuRow2(), getHelpStaffButtonsRow()],
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
  await i.update({ embeds: [buildMainMenuEmbed()], components: [buildMainMenuRow(), buildMainMenuRow2(), getHelpStaffButtonsRow()] });
});

registerButtonPrefix('helpstaff_clear', async (i) => {
  if (!(await isStaff(i))) return i.reply({ content: '❌ No tenés permisos para usar esta función.', flags: MessageFlags.Ephemeral });
  await i.showModal(buildClearModal());
});
registerButtonPrefix('helpstaff_anuncio', async (i) => {
  await startAnuncioBuilder(i);
});

registerModalPrefix('modal_helpstaff_clear', async (i) => {
  const cantidadRaw = i.fields.getTextInputValue('cantidad');
  const cantidad = parseInt(cantidadRaw, 10);

  if (Number.isNaN(cantidad) || cantidad < 1 || cantidad > 100) {
    await i.reply({ content: '❌ Ingresá un número entre 1 y 100.', flags: MessageFlags.Ephemeral });
    return;
  }

  await runClear(i, cantidad);
});
