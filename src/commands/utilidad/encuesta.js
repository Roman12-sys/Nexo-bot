import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import { registerButtonPrefix } from '../../components/buttons.js';
import { eventBus } from '../../utils/eventBus.js'; // Event Engine — auditoría 2026-08-29, Parte 7

const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const ALL_POLL_EMOJIS = [...NUMBER_EMOJIS, '👍', '👎'];

// Cooldown simple contra spam de encuestas — antes no había ningún límite: nada impedía
// crear encuestas en loop y llenar un canal de mensajes con reacciones. Ventana corta (2
// min) a propósito: no hay caso de uso legítimo para crear más de una encuesta nueva en
// ese lapso, pero tampoco corta a alguien armando varias encuestas espaciadas en una
// sesión normal. Por guild+usuario (no global) — mismo criterio multi-tenant que el
// resto del proyecto: actividad en un servidor no debe afectar el cooldown en otro.
// Mismo patrón en memoria que rateLimiter.js — no amerita persistir en Supabase, y no
// hace falta un tope de "encuestas activas simultáneas" aparte: no hay ningún tracking
// de qué encuestas siguen abiertas (se resuelven solas por reacciones, `/encuesta
// cerrar` es opcional), así que el cooldown de creación ya es el control real sobre el
// ritmo de spam.
// MOTIVO: auditoría Fase 2B, sección 12.
const POLL_COOLDOWN_MS = 2 * 60 * 1000;
const lastPollAt = new Map(); // `${guildId}:${userId}` -> timestamp de la última encuesta creada

setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of lastPollAt) {
    if (now - ts >= POLL_COOLDOWN_MS) lastPollAt.delete(key);
  }
}, 10 * 60 * 1000).unref();

export const data = new SlashCommandBuilder()
  .setName('encuesta')
  .setDescription('Crea una encuesta pública con reacciones.')
  .addStringOption((o) => o.setName('pregunta').setDescription('La pregunta de la encuesta').setRequired(true).setMaxLength(256))
  .addStringOption((o) =>
    o.setName('opciones').setDescription('Separá las opciones con comas (2-10). Si la omitís, es 👍/👎').setRequired(false).setMaxLength(500),
  )
  .setDMPermission(false);

export async function execute(interaction) {
  const cooldownKey = `${interaction.guild.id}:${interaction.user.id}`;
  const lastPoll = lastPollAt.get(cooldownKey) || 0;
  const elapsed = Date.now() - lastPoll;
  if (elapsed < POLL_COOLDOWN_MS) {
    const retryAt = Math.floor((lastPoll + POLL_COOLDOWN_MS) / 1000);
    await interaction.reply({ content: `⏳ Ya creaste una encuesta hace poco. Podés crear otra <t:${retryAt}:R>.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const pregunta = interaction.options.getString('pregunta');
  const raw = interaction.options.getString('opciones');

  const opciones = raw
    ? raw.split(',').map((o) => o.trim()).filter((o) => o.length > 0)
    : null;

  if (opciones && (opciones.length < 2 || opciones.length > 10)) {
    await interaction.reply({ content: '❌ Necesitás entre 2 y 10 opciones separadas por comas.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Recién acá se consume el cooldown — un intento rechazado por opciones inválidas
  // (arriba) no debería gastarle el turno al usuario.
  lastPollAt.set(cooldownKey, Date.now());

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('📊 Encuesta')
    .setDescription(opciones ? `**${pregunta}**\n\n${opciones.map((o, i) => `${NUMBER_EMOJIS[i]} ${o}`).join('\n')}` : `**${pregunta}**`)
    .setFooter({ text: `${BRAND_NAME} • Creada por ${interaction.user.tag}` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`encuesta_cerrar_${interaction.user.id}`).setLabel('Cerrar y ver resultado').setEmoji('🔒').setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({ embeds: [embed], components: [row] });
  const message = await interaction.fetchReply();

  const reactions = opciones ? NUMBER_EMOJIS.slice(0, opciones.length) : ['👍', '👎'];
  for (const emoji of reactions) {
    await message.react(emoji).catch(() => {});
  }

  await eventBus.emit('ACHIEVEMENT_CHECK', { guildId: interaction.guildId, userId: interaction.user.id, achievementId: 'primera_encuesta', interaction });
}

// Antes no había forma de cerrar una encuesta y ver el resultado final — quedaba para
// siempre con las reacciones abiertas. Solo quien la creó (o el staff) puede cerrarla.
registerButtonPrefix('encuesta_cerrar_', async (interaction) => {
  const creatorId = interaction.customId.slice('encuesta_cerrar_'.length);
  if (interaction.user.id !== creatorId && !(await isStaff(interaction))) {
    await interaction.reply({ content: '❌ Solo quien la creó (o el staff) puede cerrar esta encuesta.', flags: MessageFlags.Ephemeral });
    return;
  }

  // QUÉ CAMBIÓ: fetch explícito del mensaje antes de leer las reacciones — antes se leía
  // interaction.message directo, que puede traer el conteo de reacciones desactualizado
  // (discord.js lo mantiene al día vía eventos de gateway de reacciones, y el cliente NO
  // tiene el intent GuildMessageReactions prendido, así que esos eventos nunca le llegan
  // al bot). El resultado real: el cierre mostraba siempre "0 votos" en todas las
  // opciones, aunque la gente sí hubiera votado — el conteo quedaba congelado en el
  // momento en que el bot sembró sus propias reacciones. .fetch() pega un GET directo a
  // la API de Discord (no depende de ningún intent ni del cache de gateway), así que
  // siempre trae el conteo real en el momento del cierre. Si el fetch falla por lo que
  // sea, sigue con lo que ya tenía en vez de romper el cierre.
  // MOTIVO: bug reportado en vivo 2026-09-01 (votos en 0 al cerrar).
  const message = await interaction.message.fetch().catch(() => interaction.message);
  const counts = message.reactions.cache
    .filter((r) => ALL_POLL_EMOJIS.includes(r.emoji.name))
    .sort((a, b) => ALL_POLL_EMOJIS.indexOf(a.emoji.name) - ALL_POLL_EMOJIS.indexOf(b.emoji.name))
    // -1 porque el bot reaccionó primero para sembrar cada opción — no es un voto real.
    .map((r) => `${r.emoji.name} — **${Math.max(0, r.count - 1)}** voto(s)`)
    .join('\n');

  const originalEmbed = message.embeds[0];
  const closedEmbed = EmbedBuilder.from(originalEmbed)
    .setColor('#6C757D')
    .setTitle('📊 Encuesta (cerrada)')
    .addFields({ name: '🔒 Resultado final', value: counts || 'Nadie votó.' })
    .setFooter({ text: `${originalEmbed.footer?.text || BRAND_NAME} • Cerrada por ${interaction.user.tag}` });

  await interaction.update({ embeds: [closedEmbed], components: [] });

  // El resultado final ya quedó congelado arriba — dejar las reacciones originales daba
  // a entender que todavía se podía votar. Requiere permiso de Gestionar mensajes; si no
  // lo tiene (DM o config del canal), no rompe el cierre, solo quedan las reacciones.
  await message.reactions.removeAll().catch(() => {});
});
