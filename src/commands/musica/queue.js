import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { requireActiveSession } from '../../utils/musicPermissions.js';
import { buildQueueEmbed, buildQueueRow } from '../../utils/musicEmbeds.js';
import { registerButtonPrefix } from '../../components/buttons.js';

export const data = new SlashCommandBuilder().setName('queue').setDescription('Muestra la cola de reproducción.').setDMPermission(false);

export async function execute(interaction) {
  const { session, error } = requireActiveSession(interaction);
  if (error) {
    await interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
    return;
  }

  const { embed, clampedPage, totalPages } = buildQueueEmbed(session, 0);
  await interaction.reply({ embeds: [embed], components: [buildQueueRow(clampedPage, totalPages)] });
}

registerButtonPrefix('music_queue_page_', async (interaction) => {
  const { session, error } = requireActiveSession(interaction);
  if (error) {
    await interaction.update({ content: error, embeds: [], components: [] });
    return;
  }

  const page = parseInt(interaction.customId.slice('music_queue_page_'.length), 10);
  const { embed, clampedPage, totalPages } = buildQueueEmbed(session, page);
  await interaction.update({ embeds: [embed], components: [buildQueueRow(clampedPage, totalPages)] });
});
