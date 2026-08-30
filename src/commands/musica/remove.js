import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { requireActiveSessionInUserChannel } from '../../utils/musicPermissions.js';
import { remove } from '../../utils/musicEngine.js';
import { buildRemovedEmbed, buildErrorEmbed } from '../../utils/musicEmbeds.js';

export const data = new SlashCommandBuilder()
  .setName('remove')
  .setDescription('Elimina una canción de la cola por su posición.')
  .addIntegerOption((o) => o.setName('posicion').setDescription('Posición en la cola (ver /queue)').setRequired(true).setMinValue(1))
  .setDMPermission(false);

export async function execute(interaction) {
  const { session, error } = requireActiveSessionInUserChannel(interaction);
  if (error) {
    await interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
    return;
  }

  const posicion = interaction.options.getInteger('posicion', true);
  const removed = remove(session, posicion);
  if (!removed) {
    await interaction.reply({ embeds: [buildErrorEmbed(`No existe una canción en la posición ${posicion}.`)], flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({ embeds: [buildRemovedEmbed(removed, posicion)] });
}
