import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { playRequest, attachPanel } from '../../utils/musicEngine.js';
import { requireUserInVoiceChannel, requireBotVoicePermissions, getUserVoiceChannel } from '../../utils/musicPermissions.js';
import { buildNowPlayingEmbed, buildAddedToQueueEmbed, buildErrorEmbed, buildControlPanelRow } from '../../utils/musicEmbeds.js';

// Spawnea un proceso yt-dlp nuevo cada vez — cupo más chico que el resto de los
// comandos (ver rateLimiter.js).
export const rateLimitCategory = 'music';

export const data = new SlashCommandBuilder()
  .setName('play')
  .setDescription('Reproduce una canción por nombre o URL (se une a tu canal de voz).')
  .addStringOption((o) => o.setName('cancion').setDescription('Nombre a buscar o URL').setRequired(true))
  .setDMPermission(false);

export async function execute(interaction) {
  const voiceError = requireUserInVoiceChannel(interaction);
  if (voiceError) {
    await interaction.reply({ content: voiceError, flags: MessageFlags.Ephemeral });
    return;
  }

  const voiceChannel = getUserVoiceChannel(interaction);
  const permError = requireBotVoicePermissions(voiceChannel);
  if (permError) {
    await interaction.reply({ content: permError, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply();

  const query = interaction.options.getString('cancion', true);
  const result = await playRequest({
    guildId: interaction.guildId,
    voiceChannel,
    textChannel: interaction.channel,
    query,
    requestedByUserId: interaction.user.id,
    requestedByTag: interaction.user.tag,
  });

  if (result.status === 'error') {
    await interaction.editReply({ embeds: [buildErrorEmbed(result.message)] });
    return;
  }

  if (result.status === 'now_playing') {
    // La respuesta ES el panel de control (embed + botones) — pausar/saltar/mezclar/
    // loop se manejan desde ahí, no tienen comando slash propio (ver el límite de 100
    // comandos globales de Discord). El mensaje devuelto queda enganchado a la sesión
    // para que musicEngine.js lo edite in-place en cada cambio de estado.
    const message = await interaction.editReply({
      embeds: [
        buildNowPlayingEmbed({
          track: result.track,
          loopMode: result.session.loopMode,
          volume: result.session.volume,
          queueLength: result.session.queue.length,
          playbackDurationMs: 0,
        }),
      ],
      components: buildControlPanelRow({ isPaused: false, loopMode: result.session.loopMode }),
    });
    attachPanel(result.session, message);
    return;
  }

  await interaction.editReply({
    embeds: [buildAddedToQueueEmbed({ track: result.track, position: result.position, queueLength: result.queueLength })],
  });
}
