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

// Construye el embed del anuncio a partir del draft del panel /anuncio (ver
// src/commands/anuncios/anuncio.js). Cada pieza es opcional salvo título+descripción,
// que el panel exige antes de habilitar "Enviar" — así el embed nunca queda vacío (la
// API de Discord rechaza un embed sin ningún campo con contenido).
export function buildAnuncioEmbed(draft) {
  const embed = new EmbedBuilder().setColor(draft.color || BRAND_COLOR);

  if (draft.title) embed.setTitle(draft.title);
  if (draft.description) embed.setDescription(draft.description);
  if (draft.url && draft.title) embed.setURL(draft.url);

  if (draft.authorName) {
    embed.setAuthor({
      name: draft.authorName,
      iconURL: draft.authorIconURL || undefined,
      url: draft.authorURL || undefined,
    });
  }

  if (draft.thumbnailURL) embed.setThumbnail(draft.thumbnailURL);
  if (draft.imageURL) embed.setImage(draft.imageURL);

  if (draft.fields?.length) {
    embed.addFields(draft.fields.map((f) => ({ name: f.name || '​', value: f.value || '​', inline: !!f.inline })));
  }

  // Un iconURL de footer sin texto no es válido para la API — se ignora en silencio en vez de bloquear al usuario.
  if (draft.footerText) embed.setFooter({ text: draft.footerText, iconURL: draft.footerIconURL || undefined });
  if (draft.timestamp) embed.setTimestamp();

  return embed;
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
