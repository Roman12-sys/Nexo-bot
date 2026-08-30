import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { requireActiveSession } from '../../utils/musicPermissions.js';
import { buildNowPlayingEmbed, buildQueueEmptyEmbed } from '../../utils/musicEmbeds.js';

export const data = new SlashCommandBuilder()
  .setName('nowplaying')
  .setDescription('Muestra qué se está reproduciendo ahora mismo.')
  .setDMPermission(false);

export async function execute(interaction) {
  const { session, error } = requireActiveSession(interaction);
  if (error) {
    await interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
    return;
  }

  if (!session.current) {
    await interaction.reply({ embeds: [buildQueueEmptyEmbed()], flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({
    embeds: [
      buildNowPlayingEmbed({
        track: session.current,
        loopMode: session.loopMode,
        volume: session.volume,
        queueLength: session.queue.length,
        playbackDurationMs: session.resource?.playbackDuration ?? 0,
      }),
    ],
  });
}
