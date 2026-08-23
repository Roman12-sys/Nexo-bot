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
    new ButtonBuilder().setCustomId('helpstaff_cat_xp').setLabel('⭐ XP y niveles').setStyle(ButtonStyle.Secondary),
  );
}

export function buildBackRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('helpstaff_back').setLabel('🔙 Volver al menú').setStyle(ButtonStyle.Secondary),
  );
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
      { name: '/warns <usuario>', value: 'Muestra las advertencias de un usuario.' },
      { name: '/unwarn <usuario> [número]', value: 'Quita una advertencia (o todas si no se indica número).' },
      { name: '/punish <usuario>', value: 'Impide que un usuario envíe imágenes o enlaces (requiere `/config rol-castigo`).' },
      { name: '/unpunish <usuario>', value: 'Quita esa restricción.' },
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
      { name: '/sorteo crear/terminar/reroll/cancelar', value: 'Sistema de sorteos con botón de participación.' },
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
      { name: '/shop-admin agregar/quitar/listar', value: 'Arma el catálogo de /shop propio de este servidor (nombre, precio, rol opcional, entrega manual o automática).' },
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
