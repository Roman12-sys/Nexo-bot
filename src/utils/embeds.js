import { EmbedBuilder } from 'discord.js';

export const BRAND_NAME = 'Nexo Bot';
export const BRAND_COLOR = '#7F5AF0';
export const LOG_COLOR = '#E63946';

// Barra de progreso tipo [■■■■■■□□□□] usada por /nivel para mostrar el avance
// hacia el siguiente nivel de XP. length = cantidad de segmentos totales.
export function buildProgressBar(current, total, length = 12) {
  const ratio = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0;
  const filled = Math.round(ratio * length);
  return `${'■'.repeat(filled)}${'□'.repeat(length - filled)}`;
}

export function progressPercent(current, total) {
  return total > 0 ? Math.floor((current / total) * 100) : 0;
}

// participantsCount solo lo pasa /sorteo crear explícitamente (arranca en 0, no hay
// array todavía). El resto de los call sites (entrar/salir, terminar, reroll, cancelar)
// spread-ean el objeto guardado, que tiene "participants" (el array) pero no "participantsCount" —
// sin este fallback, esos embeds mostrarían literalmente "undefined".
export function createGiveawayEmbed({ prize, winnersCount, endTimestamp, participantsCount, participants, ended, winners, cancelled }) {
  const count = typeof participantsCount === 'number' ? participantsCount : (participants ? participants.length : 0);
  const embed = new EmbedBuilder()
    .setColor(cancelled ? '#6C757D' : ended ? '#2A9D8F' : BRAND_COLOR)
    .setTitle(cancelled ? '🚫 Sorteo cancelado' : ended ? '🎉 Sorteo finalizado' : '🎉 ¡Sorteo activo!')
    .addFields(
      { name: 'Premio', value: prize },
      { name: 'Ganadores', value: `${winnersCount}`, inline: true },
      { name: 'Participantes', value: `${count}`, inline: true },
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();

  if (!ended && !cancelled) {
    embed.addFields({ name: 'Finaliza', value: `<t:${Math.floor(endTimestamp / 1000)}:R>` });
    embed.setDescription('Tocá el botón 🎉 para participar.');
  } else if (ended) {
    embed.addFields({
      name: 'Ganador(es)',
      value: winners && winners.length > 0 ? winners.map((id) => `<@${id}>`).join(', ') : 'Nadie participó',
    });
  }

  return embed;
}
