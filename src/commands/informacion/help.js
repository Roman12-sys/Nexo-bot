import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { registerButtonPrefix } from '../../components/buttons.js';
import { buildInfoEmbed as buildUserInfoEmbed } from './info.js';
import { buildServerEmbed, buildServerRow } from './servidor.js';
import { buildAvatarEmbed } from './avatar.js';
import { config } from '../../config.js';
import { getGuildConfig } from '../../utils/guildConfigStore.js';
import { buildSelfRolesMessage } from '../../utils/selfRoles.js';

export function getHelpButtonsRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('help_info').setLabel('👤 Mi perfil').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('help_servidor').setLabel('📊 Servidor').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('help_avatar').setLabel('🖼️ Mi avatar').setStyle(ButtonStyle.Secondary),
  );
}

// COM-3, Fase 4B: antes no había NINGÚN lugar donde un cliente supiera dónde pedir
// ayuda con el bot en sí (no con moderación de SU server, sino con Nexo). Se muestra
// solo si config.supportContact está configurado (env var SUPPORT_CONTACT) — nunca un
// link inventado ni un campo vacío/roto.
// CICLO 1, Mejora 2/2 (experiencia del miembro, "descubrimiento") — antes esto listaba
// SIEMPRE las mismas 5 categorías sin importar qué tenga activado el servidor; un
// miembro nuevo no tenía ninguna guía de "por dónde empiezo" más allá de adivinar. Estas
// líneas se arman en base a guild_config REAL: /nivel solo si XP está activado, /report
// solo si tiene algún destino real configurado, roles autoasignables solo si hay al
// menos uno cargado — nunca se menciona algo que este servidor no puede usar.
function buildPrimerosPasosLines(cfg) {
  const features = cfg.features || {};
  const lines = ['👤 `/perfil` — tu nivel, monedas, logros y sanciones, todo junto.', '💰 `/daily` — reclamá tu recompensa diaria.'];

  if (features.xp) lines.push('⭐ `/nivel` — tu tarjeta de XP y progreso hacia el siguiente nivel.');
  lines.push('🧠 `/trivia jugar` — sumá puntos respondiendo preguntas.');
  if (cfg.report_channel_id || cfg.log_channel_moderation_id) lines.push('🚨 `/report` — reportá un usuario, un mensaje o una situación al staff.');
  if ((cfg.selfassignable_roles || []).length > 0) lines.push('🎭 Tocá **Mis roles** acá abajo para elegir tus roles.');

  return lines;
}

// cfg es opcional (default {}) para no romper la firma sync/pura de esta función — los
// call-sites reales (execute/help_back) le pasan la config ya resuelta de este server;
// sin ella, simplemente no se arma el campo de "Primeros pasos" (nunca revienta).
export function buildMainMenuEmbed(cfg = {}) {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`📖 Centro de ayuda de ${BRAND_NAME}`)
    .setDescription(
      `**${BRAND_NAME}** es la plataforma para administrar y hacer crecer tu comunidad de Discord — moderación, ` +
        'economía, progresión (XP/niveles) y herramientas de gestión, todo en un solo lugar.\n\n' +
        'Elegí una categoría tocando un botón de abajo para ver sus comandos.',
    )
    .addFields({ name: '🚀 Primeros pasos', value: buildPrimerosPasosLines(cfg).join('\n') })
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();

  if (config.supportContact) {
    embed.addFields({ name: '🆘 ¿Necesitás ayuda con el bot?', value: config.supportContact });
  }

  return embed;
}

// Devuelve un ARRAY de filas (no una sola) — los call sites spreadean esto directo en
// `components`, nunca lo envuelven en un array extra. Con 5 categorías entran todas en
// una sola ActionRow (máximo 5 de Discord); "Mis roles" necesita una SEGUNDA fila (ya
// no entra ninguna más en la primera) y solo se agrega si el server tiene al menos un
// rol autoasignable configurado — nunca un botón que lleva a "no hay nada acá".
export function buildMainMenuRow(showRolesButton = false) {
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('help_cat_info').setLabel('ℹ️ Información').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('help_cat_economia').setLabel('💰 Economía').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('help_cat_casino').setLabel('🎰 Casino').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('help_cat_diversion').setLabel('🎲 Diversión').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('help_cat_accion').setLabel('🎭 Acción').setStyle(ButtonStyle.Secondary),
    ),
  ];

  if (showRolesButton) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('help_roles').setLabel('🎭 Mis roles').setStyle(ButtonStyle.Primary),
      ),
    );
  }

  return rows;
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
      { name: '/perfil [usuario]', value: 'Perfil completo: nivel, XP, monedas, trivia, warns, sorteos ganados y logros desbloqueados.' },
      { name: '/nivel [usuario]', value: 'Muestra tu tarjeta de nivel, XP y progreso hacia el siguiente nivel.' },
      { name: '/ranking', value: 'Top de niveles/XP del servidor.' },
      { name: '/prestigio', value: 'Desde nivel 50: reseteá tu nivel a cambio de una insignia permanente.' },
      { name: '/mision', value: 'Misiones diarias y semanales — se completan y pagan solas (monedas y XP) al cumplir el objetivo, sin nada que reclamar.' },
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
      { name: '/daily', value: 'Reclamá tu recompensa diaria (con racha: más días seguidos, más bonus).' },
      { name: '/weekly', value: 'Recompensa semanal, mucho más grande que /daily.' },
      { name: '/work', value: 'Trabajá para ganar monedas (cooldown 1 hora).' },
      { name: '/crime', value: 'Alternativa arriesgada a /work: mejor paga, cooldown más corto, pero podés perder monedas si te agarran.' },
      { name: '/give <usuario> <cantidad>', value: 'Transferí monedas a otro usuario.' },
      { name: '🎰 Casino', value: 'Ver botón de abajo — coinflip, dado, slots y ruleta tienen su propia categoría.' },
      { name: '/shop', value: 'Muestra la tienda.' },
      { name: '/buy <item>', value: 'Comprá un ítem.' },
      { name: '/vender <item>', value: 'Vendé un ítem de tu inventario por la mitad de su precio.' },
      { name: '/inventory [usuario]', value: 'Muestra tu inventario.' },
      { name: '/leaderboard', value: 'Top de monedas del servidor, paginado.' },
      { name: '/bank ver/depositar/retirar', value: 'Guardá monedas en el banco — a salvo de /rob, y rinde interés.' },
      { name: '/rob <usuario>', value: 'Intentá robarle monedas del wallet a otro usuario. 40% de éxito, con riesgo de multa.' },
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();
}

export function buildCasinoEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🎰 Casino')
    .setDescription('Todos apuestan monedas de tu wallet — usá `/bank depositar` para guardar lo que no querés arriesgar.')
    .addFields(
      { name: '/coinflip <apuesta> <cara/cruz>', value: 'Cara o cruz. 50/50, sin ventaja de la casa.' },
      { name: '/dado <apuesta>', value: 'Duelo de dados contra el bot (1-100). Empate devuelve la apuesta.' },
      { name: '/slots <apuesta>', value: 'Tragamonedas: 3 iguales pagan según el símbolo, 2 iguales devuelve la apuesta.' },
      { name: '/ruleta <apuesta> <color>', value: 'Rojo/negro pagan x2, verde (el 0) paga x30.' },
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();
}

export function buildDiversionEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🎲 Diversión')
    .setDescription('`/8ball` `/roll` `/choose` `/trivia jugar` `/trivia ranking` `/banana` `/guess` `/lucky` `/kitty` `/pupper` `/confession` `/encuesta` `/afk` `/recordatorio` `/report`')
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
  const cfg = await getGuildConfig(interaction.guildId);
  await interaction.reply({
    embeds: [buildMainMenuEmbed(cfg)],
    components: buildMainMenuRow((cfg.selfassignable_roles || []).length > 0),
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
registerButtonPrefix('help_cat_casino', async (i) => {
  await i.update({ embeds: [buildCasinoEmbed()], components: [buildBackRow()] });
});
registerButtonPrefix('help_cat_diversion', async (i) => {
  await i.update({ embeds: [buildDiversionEmbed()], components: [buildBackRow()] });
});
registerButtonPrefix('help_cat_accion', async (i) => {
  await i.update({ embeds: [buildAccionEmbed()], components: [buildBackRow()] });
});
registerButtonPrefix('help_back', async (i) => {
  const cfg = await getGuildConfig(i.guildId);
  await i.update({ embeds: [buildMainMenuEmbed(cfg)], components: buildMainMenuRow((cfg.selfassignable_roles || []).length > 0) });
});

// CICLO 1, Mejora 2/2 — reabre el mismo menú de roles autoasignables que ya se ofrece
// en el mensaje de bienvenida (src/utils/selfRoles.js): un miembro que ya pasó ese
// momento (o que quiere cambiar de opinión más tarde) tiene acá su segunda entrada,
// sin que exista ningún comando dedicado ni una lógica duplicada.
registerButtonPrefix('help_roles', async (i) => {
  const message = await buildSelfRolesMessage(i.guild, i.member);
  if (!message) {
    await i.reply({ content: 'ℹ️ Este servidor todavía no tiene roles autoasignables configurados.', flags: MessageFlags.Ephemeral });
    return;
  }
  await i.reply({ ...message, flags: MessageFlags.Ephemeral });
});
