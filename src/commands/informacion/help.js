import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { registerButtonPrefix } from '../../components/buttons.js';
import { buildInfoEmbed as buildUserInfoEmbed } from './info.js';
import { buildServerEmbed, buildServerRow } from './servidor.js';
import { buildAvatarEmbed } from './avatar.js';

export function getHelpButtonsRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('help_info').setLabel('👤 Mi perfil').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('help_servidor').setLabel('📊 Servidor').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('help_avatar').setLabel('🖼️ Mi avatar').setStyle(ButtonStyle.Secondary),
  );
}

export function buildMainMenuEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`📖 Centro de ayuda de ${BRAND_NAME}`)
    .setDescription('Elegí una categoría tocando un botón de abajo para ver sus comandos.')
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();
}

export function buildMainMenuRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('help_cat_info').setLabel('ℹ️ Información').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('help_cat_economia').setLabel('💰 Economía').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('help_cat_diversion').setLabel('🎲 Diversión').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('help_cat_accion').setLabel('🎭 Acción').setStyle(ButtonStyle.Secondary),
  );
}

export function buildBackRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('help_back').setLabel('🔙 Volver al menú').setStyle(ButtonStyle.Secondary),
  );
}

export function buildInfoEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('ℹ️ Información')
    .addFields(
      { name: '/info [usuario]', value: 'Muestra información de tu perfil o el de otro usuario.' },
      { name: '/perfil [usuario]', value: 'Perfil completo: nivel, XP, monedas, trivia, reputación, warns, sorteos ganados y logros desbloqueados.' },
      { name: '/nivel [usuario]', value: 'Muestra tu nivel, XP y progreso hacia el siguiente nivel.' },
      { name: '/ranking', value: 'Top de niveles/XP del servidor.' },
      { name: '/servidor', value: 'Muestra información general sobre el servidor.' },
      { name: '/avatar [usuario]', value: 'Muestra el avatar de un usuario en tamaño completo.' },
      { name: '/ping', value: 'Latencia del bot — para confirmar que está funcionando.' },
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();
}

export function buildEconomiaEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('💰 Economía')
    .addFields(
      { name: '/balance [usuario]', value: 'Muestra cuántas monedas tenés.' },
      { name: '/daily', value: 'Reclamá tu recompensa diaria.' },
      { name: '/work', value: 'Trabajá para ganar monedas (cooldown 1 hora).' },
      { name: '/give <usuario> <cantidad>', value: 'Transferí monedas a otro usuario.' },
      { name: '/shop', value: 'Muestra la tienda.' },
      { name: '/buy <item>', value: 'Comprá un ítem.' },
      { name: '/inventory [usuario]', value: 'Muestra tu inventario.' },
      { name: '/leaderboard', value: 'Top de monedas del servidor, paginado.' },
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();
}

export function buildDiversionEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🎲 Diversión')
    .setDescription('`/8ball` `/roll` `/choose` `/trivia jugar` `/trivia ranking` `/banana` `/guess` `/lucky` `/kitty` `/pupper` `/reputation dar` `/reputation ranking` `/confession` `/encuesta` `/afk` `/recordatorio`')
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();
}

export function buildAccionEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🎭 Acción')
    .setDescription(
      'Todos podés usarlos solos o mencionando a alguien.\n\n`/hug` `/kiss` `/slap` `/pat` `/poke` `/punch` `/shoot` `/stare` `/tickle` `/laugh` `/bite` `/baka` `/angry` `/cuddle` `/feed` `/highfive` `/claps` `/handholding` `/hi` `/kickbutt` `/scared`',
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();
}

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Muestra los comandos disponibles para todos los miembros.')
  .setDMPermission(false);

export async function execute(interaction) {
  await interaction.reply({
    embeds: [buildMainMenuEmbed()],
    components: [buildMainMenuRow()],
    flags: MessageFlags.Ephemeral,
  });
}

registerButtonPrefix('help_cat_info', async (i) => {
  await i.update({ embeds: [buildInfoEmbed()], components: [getHelpButtonsRow(), buildBackRow()] });
});
registerButtonPrefix('help_info', async (i) => {
  const embed = await buildUserInfoEmbed(i.guild, i.user);
  if (!embed) return i.reply({ content: '❌ No se pudo obtener tu información.', flags: MessageFlags.Ephemeral });
  await i.reply({ embeds: [embed] });
});
registerButtonPrefix('help_servidor', async (i) => {
  await i.reply({ embeds: [buildServerEmbed(i.guild)], components: [buildServerRow()] });
});
registerButtonPrefix('help_avatar', async (i) => {
  const embed = await buildAvatarEmbed(i.guild, i.user);
  await i.reply({ embeds: [embed] });
});
registerButtonPrefix('help_cat_economia', async (i) => {
  await i.update({ embeds: [buildEconomiaEmbed()], components: [buildBackRow()] });
});
registerButtonPrefix('help_cat_diversion', async (i) => {
  await i.update({ embeds: [buildDiversionEmbed()], components: [buildBackRow()] });
});
registerButtonPrefix('help_cat_accion', async (i) => {
  await i.update({ embeds: [buildAccionEmbed()], components: [buildBackRow()] });
});
registerButtonPrefix('help_back', async (i) => {
  await i.update({ embeds: [buildMainMenuEmbed()], components: [buildMainMenuRow()] });
});
