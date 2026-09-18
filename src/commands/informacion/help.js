import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { BRAND_COLOR, BRAND_NAME, EMERALD_COLOR, GOLD_COLOR } from '../../utils/embeds.js';
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
// líneas se arman en base a guild_config REAL: /nivel solo si XP está activado, roles
// autoasignables solo si hay al menos uno cargado — nunca se menciona algo que este
// servidor no puede usar.
function buildPrimerosPasosLines(cfg) {
  const features = cfg.features || {};
  const lines = ['👤 `/perfil` — tu nivel, monedas, logros y sanciones, todo junto.', '💰 `/daily` — reclamá tu recompensa diaria.'];

  if (features.xp) lines.push('⭐ `/nivel` — tu tarjeta de XP y progreso hacia el siguiente nivel.');
  lines.push('🧠 `/trivia jugar` — sumá puntos respondiendo preguntas.');
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

// Auditoría UX/UI (2026-09-18), hallazgo Importante "Economía es una pared de 14
// campos": correcto comando por comando, pero sin separar "para empezar" de
// "avanzado". Los 3 básicos son los mismos que ya recomienda buildPrimerosPasosLines()
// del home de /help — mismo criterio en los dos lugares, no una selección nueva.
export function buildEconomiaEmbed() {
  return new EmbedBuilder()
    .setColor(EMERALD_COLOR)
    .setTitle('💰 Economía')
    .addFields(
      {
        name: '🌱 Para empezar',
        value: [
          '`/daily` — Reclamá tu recompensa diaria (con racha: más días seguidos, más bonus).',
          '`/work` — Trabajá para ganar monedas (cooldown 1 hora).',
          '`/shop` — Muestra la tienda.',
        ].join('\n'),
      },
      {
        name: '📈 El resto',
        value: [
          '`/balance [usuario]` — Muestra cuántas monedas tenés.',
          '`/weekly` — Recompensa semanal, mucho más grande que /daily.',
          '`/crime` — Alternativa arriesgada a /work: mejor paga, cooldown más corto, pero podés perder monedas si te agarran.',
          '`/give <usuario> <cantidad>` — Transferí monedas a otro usuario.',
          '🎰 Casino — Ver botón de abajo: coinflip, dado, slots y ruleta tienen su propia categoría.',
          '`/buy <item>` — Comprá un ítem.',
          '`/vender <item>` — Vendé un ítem de tu inventario por la mitad de su precio.',
          '`/inventory [usuario]` — Muestra tu inventario.',
          '`/leaderboard` — Top de monedas del servidor, paginado.',
          '`/bank ver/depositar/retirar` — Guardá monedas en el banco, a salvo de /rob, y rinde interés.',
          '`/rob <usuario>` — Intentá robarle monedas del wallet a otro usuario. 40% de éxito, con riesgo de multa.',
        ].join('\n'),
      },
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();
}

export function buildCasinoEmbed() {
  return new EmbedBuilder()
    // GOLD_COLOR, no EMERALD_COLOR — auditoría NEXO V (2026-09-18): Casino es
    // apuesta+resultado inmediato (progresión), no wallet/banco, y /staff ya coloreaba
    // el equivalente "Minijuegos" en oro; los dos paneles de navegación más usados del
    // bot ahora coinciden en el mismo criterio para el mismo grupo de comandos.
    .setColor(GOLD_COLOR)
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

// Auditoría UX/UI (2026-09-18), hallazgo Crítico #1: antes era una sola descripción con
// 14 nombres de comando pegados entre backticks, sin una palabra de qué hacen cada uno —
// exactamente "la lista interminable de comandos" que se pidió evitar. Mismo formato que
// Información/Economía/Casino: un campo por comando con descripción de una línea.
export function buildDiversionEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🎲 Diversión')
    .addFields(
      { name: '/8ball <pregunta>', value: 'Le preguntás algo a la bola mágica.' },
      { name: '/roll [caras] [cantidad]', value: 'Tirá uno o varios dados.' },
      { name: '/choose <opciones>', value: 'El bot elige una opción al azar por vos.' },
      { name: '/trivia jugar [dificultad]', value: 'Respondé una pregunta de trivia y ganá puntos.' },
      { name: '/trivia ranking', value: 'Muestra el ranking de puntos de trivia.' },
      { name: '/banana', value: 'Comando sin ningún sentido, pero divertido.' },
      { name: '/guess <numero>', value: 'Adiviná un número secreto entre 1 y 100.' },
      { name: '/lucky', value: 'Consultá tu número y frase de la suerte del día.' },
      { name: '/kitty', value: 'Muestra una foto random de un gato.' },
      { name: '/pupper', value: 'Muestra una foto random de un perro.' },
      { name: '/confession <mensaje>', value: 'Enviá una confesión anónima al canal de confesiones.' },
      { name: '/encuesta <pregunta> [opciones]', value: 'Creá una encuesta pública con reacciones.' },
      { name: '/afk [motivo]', value: 'Te marca como ausente — se te quita solo al escribir de nuevo.' },
      { name: '/recordatorio crear/listar/cancelar', value: 'Recordatorios personales, te avisa por DM.' },
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();
}

// Mismo hallazgo Crítico #1 que Diversión (20 comandos entre backticks, sin descripción)
// — acá la solución de la auditoría es distinta a propósito: "un campo por comando"
// volvería esto una pared de 20 campos idénticos, así que se agrupa por sub-bloque
// temático DENTRO de 3 campos (cariñosas / molestas / reacciones) en vez de lista plana.
export function buildAccionEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🎭 Acción')
    .setDescription('Todos podés usarlos solos (le pasa a vos mismo/a) o mencionando a alguien.')
    .addFields(
      {
        name: '🤗 Cariñosas',
        value: [
          '`/hug [usuario]` — Le das un abrazo a alguien.',
          '`/kiss [usuario]` — Le das un beso a alguien.',
          '`/pat [usuario]` — Le hacés cariño a alguien.',
          '`/cuddle [usuario]` — Te acurrucás con alguien.',
          '`/feed [usuario]` — Le das de comer a alguien.',
          '`/highfive [usuario]` — Chocás los cinco con alguien.',
          '`/claps [usuario]` — Le aplaudís a alguien.',
          '`/handholding [usuario]` — Le agarrás la mano a alguien.',
          '`/hi [usuario]` — Saludás a alguien.',
        ].join('\n'),
      },
      {
        name: '😤 Molestas',
        value: [
          '`/slap [usuario]` — Le das una cachetada a alguien.',
          '`/punch [usuario]` — Le pegás un puñetazo a alguien.',
          '`/shoot [usuario]` — Le disparás a alguien.',
          '`/bite [usuario]` — Le mordés a alguien.',
          '`/baka [usuario]` — Le decís baka a alguien.',
          '`/kickbutt [usuario]` — Le pegás una patada a alguien.',
          '`/poke [usuario]` — Le picás a alguien.',
          '`/tickle [usuario]` — Le hacés cosquillas a alguien.',
        ].join('\n'),
      },
      {
        name: '😳 Reacciones',
        value: [
          '`/laugh [usuario]` — Te reís de alguien.',
          '`/angry [usuario]` — Mostrás que estás enojado/a (con alguien, si querés).',
          '`/scared [usuario]` — Mostrás que estás asustado/a (por alguien, si querés).',
          '`/stare [usuario]` — Mirás fijo a alguien.',
        ].join('\n'),
      },
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
// Ephemeral — H3, auditoría completa NEXO: /help entero ya es ephemeral, pero estos 3
// botones de acceso rápido posteaban público. Alguien navegando el panel de ayuda
// (que solo ve él) terminaba exponiendo su perfil/avatar al canal entero con un click
// que no esperaba que tuviera ese efecto. /servidor y /avatar como comandos DIRECTOS
// siguen siendo públicos — esto es solo el atajo desde dentro de /help.
registerButtonPrefix('help_info', async (i) => {
  const embed = await buildUserInfoEmbed(i.guild, i.user);
  if (!embed) return i.reply({ content: '❌ No se pudo obtener tu información.', flags: MessageFlags.Ephemeral });
  await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
});
registerButtonPrefix('help_servidor', async (i) => {
  await i.reply({ embeds: [buildServerEmbed(i.guild)], components: [buildServerRow()], flags: MessageFlags.Ephemeral });
});
registerButtonPrefix('help_avatar', async (i) => {
  const embed = await buildAvatarEmbed(i.guild, i.user);
  await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
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
