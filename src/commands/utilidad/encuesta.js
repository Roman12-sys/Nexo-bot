import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import { registerButtonPrefix } from '../../components/buttons.js';
import { eventBus } from '../../utils/eventBus.js'; // Event Engine — auditoría 2026-08-29, Parte 7

const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const ALL_POLL_EMOJIS = [...NUMBER_EMOJIS, '👍', '👎'];

export const data = new SlashCommandBuilder()
  .setName('encuesta')
  .setDescription('Crea una encuesta pública con reacciones.')
  .addStringOption((o) => o.setName('pregunta').setDescription('La pregunta de la encuesta').setRequired(true).setMaxLength(256))
  .addStringOption((o) =>
    o.setName('opciones').setDescription('Separá las opciones con comas (2-10). Si la omitís, es 👍/👎').setRequired(false).setMaxLength(500),
  )
  .setDMPermission(false);

export async function execute(interaction) {
  const pregunta = interaction.options.getString('pregunta');
  const raw = interaction.options.getString('opciones');

  const opciones = raw
    ? raw.split(',').map((o) => o.trim()).filter((o) => o.length > 0)
    : null;

  if (opciones && (opciones.length < 2 || opciones.length > 10)) {
    await interaction.reply({ content: '❌ Necesitás entre 2 y 10 opciones separadas por comas.', flags: MessageFlags.Ephemeral });
    return;
  }

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

  const message = interaction.message;
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
