// Todos los embeds del sistema de música, en un solo archivo dedicado — mismo rol que
// tempVoicePanel.js cumple para las salas de voz temporales (panel + embeds de una
// feature compleja, separado del embeds.js genérico de marca).
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { BRAND_COLOR, BRAND_NAME, buildProgressBar } from './embeds.js';

const OK_COLOR = '#2A9D8F';
const WARN_COLOR = '#E9C46A';
const ERROR_COLOR = '#E63946';
const QUEUE_PAGE_SIZE = 10;

function formatDuration(seconds) {
  if (seconds == null) return '🔴 En vivo / desconocida';
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function requesterText(track) {
  return track.requestedBy?.id ? `<@${track.requestedBy.id}>` : 'Desconocido';
}

function baseMusicEmbed({ color = BRAND_COLOR, title, description }) {
  const embed = new EmbedBuilder().setColor(color).setTitle(title).setFooter({ text: BRAND_NAME }).setTimestamp();
  if (description) embed.setDescription(description);
  return embed;
}

// playbackDurationMs viene de resource.playbackDuration (@discordjs/voice ya lo calcula
// descontando pausas — no hace falta llevar un cronómetro propio).
export function buildNowPlayingEmbed({ track, loopMode, volume, queueLength, playbackDurationMs }) {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🎵 Reproduciendo ahora')
    .addFields(
      { name: 'Título', value: track.title.slice(0, 256) },
      { name: 'Canal/Artista', value: track.uploader || 'Desconocido', inline: true },
      { name: 'Duración', value: formatDuration(track.durationSec), inline: true },
      { name: 'Solicitado por', value: requesterText(track), inline: true },
      { name: 'Volumen', value: `${volume}%`, inline: true },
      { name: 'Loop', value: loopMode === 'off' ? 'Desactivado' : loopMode === 'track' ? 'Canción actual' : 'Cola completa', inline: true },
      { name: 'En cola', value: `${queueLength} canción(es)`, inline: true },
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();

  if (track.thumbnail) embed.setThumbnail(track.thumbnail);

  if (!track.isLive && typeof track.durationSec === 'number' && track.durationSec > 0 && typeof playbackDurationMs === 'number') {
    const elapsedSec = playbackDurationMs / 1000;
    embed.addFields({
      name: 'Progreso',
      value: `${buildProgressBar(elapsedSec, track.durationSec, 16)}  ${formatDuration(elapsedSec)} / ${formatDuration(track.durationSec)}`,
    });
  }

  return embed;
}

export function buildAddedToQueueEmbed({ track, position, queueLength }) {
  const embed = baseMusicEmbed({ color: OK_COLOR, title: '✅ Agregado a la cola' })
    .addFields(
      { name: 'Título', value: track.title.slice(0, 256) },
      { name: 'Duración', value: formatDuration(track.durationSec), inline: true },
      { name: 'Solicitado por', value: requesterText(track), inline: true },
      { name: 'Posición en cola', value: `${position} de ${queueLength}`, inline: true },
    );
  if (track.thumbnail) embed.setThumbnail(track.thumbnail);
  return embed;
}

export function buildQueueEmbed(session, page = 0) {
  const totalPages = Math.max(1, Math.ceil(session.queue.length / QUEUE_PAGE_SIZE));
  const clampedPage = Math.min(Math.max(0, page), totalPages - 1);
  const slice = session.queue.slice(clampedPage * QUEUE_PAGE_SIZE, clampedPage * QUEUE_PAGE_SIZE + QUEUE_PAGE_SIZE);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('📜 Cola de reproducción')
    .setFooter({ text: `${BRAND_NAME} • Página ${clampedPage + 1}/${totalPages}` })
    .setTimestamp();

  if (session.current) {
    embed.addFields({
      name: '▶️ Reproduciendo ahora',
      value: `**${session.current.title}** — ${formatDuration(session.current.durationSec)} — ${requesterText(session.current)}`,
    });
  } else {
    embed.addFields({ name: '▶️ Reproduciendo ahora', value: 'Nada por el momento.' });
  }

  if (session.queue.length === 0) {
    embed.addFields({ name: 'Próximas canciones', value: 'La cola está vacía.' });
  } else {
    const lines = slice.map((track, i) => {
      const globalIndex = clampedPage * QUEUE_PAGE_SIZE + i + 1;
      return `**${globalIndex}.** ${track.title} — ${formatDuration(track.durationSec)} — ${requesterText(track)}`;
    });
    embed.addFields({ name: `Próximas canciones (${session.queue.length})`, value: lines.join('\n').slice(0, 1024) });
  }

  return { embed, clampedPage, totalPages };
}

export function buildQueueRow(clampedPage, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`music_queue_page_${clampedPage - 1}`)
      .setLabel('◀️ Anterior')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clampedPage <= 0),
    new ButtonBuilder()
      .setCustomId(`music_queue_page_${clampedPage + 1}`)
      .setLabel('Siguiente ▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clampedPage >= totalPages - 1),
  );
}

export function buildQueueEmptyEmbed() {
  return baseMusicEmbed({ color: WARN_COLOR, title: 'ℹ️ La cola está vacía', description: 'Usá `/play` para agregar una canción.' });
}

export function buildErrorEmbed(message) {
  return baseMusicEmbed({ color: ERROR_COLOR, title: '❌ Error', description: message });
}

export function buildDisconnectedEmbed(reason) {
  return baseMusicEmbed({ color: WARN_COLOR, title: '👋 Desconectado', description: reason || 'Se cerró la sesión de música.' });
}

export function buildVolumeChangedEmbed(volume) {
  return baseMusicEmbed({ color: OK_COLOR, title: '🔊 Volumen actualizado', description: `Ahora está en **${volume}%**.` });
}

export function buildLoopChangedEmbed(mode) {
  const text = mode === 'off' ? 'Desactivado' : mode === 'track' ? 'Canción actual 🔂' : 'Cola completa 🔁';
  return baseMusicEmbed({ color: OK_COLOR, title: '🔁 Modo de repetición', description: text });
}

export function buildRemovedEmbed(track, position) {
  return baseMusicEmbed({ color: OK_COLOR, title: '🗑️ Canción eliminada de la cola', description: `**#${position} — ${track.title}**` });
}

// Botones del panel de control que acompaña al embed de "reproduciendo ahora" — evita
// que pausar/reanudar/saltar/mezclar necesiten su propio comando slash (ver el límite de
// 100 comandos globales de Discord). Mismo patrón que tempVoicePanel.js: el panel se
// reconstruye entero (embed + estos botones) cada vez que cambia el estado, nunca se
// edita un botón suelto.
export function buildControlPanelRow({ isPaused, loopMode }) {
  const loopLabel = loopMode === 'off' ? '🔁 Loop: Off' : loopMode === 'track' ? '🔂 Loop: Canción' : '🔁 Loop: Cola';
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('music_panel_toggle').setLabel(isPaused ? '▶️ Reanudar' : '⏸️ Pausar').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('music_panel_skip').setLabel('⏭️ Saltar').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('music_panel_stop').setLabel('⏹️ Detener').setStyle(ButtonStyle.Danger),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('music_panel_shuffle').setLabel('🔀 Mezclar').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('music_panel_loop').setLabel(loopLabel).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('music_panel_queue').setLabel('📜 Cola').setStyle(ButtonStyle.Secondary),
    ),
  ];
}
