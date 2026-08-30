import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { requireActiveSessionInUserChannel } from '../../utils/musicPermissions.js';
import { setVolume } from '../../utils/musicEngine.js';
import { buildVolumeChangedEmbed } from '../../utils/musicEmbeds.js';
import { MIN_VOLUME, MAX_VOLUME } from '../../utils/musicSessionStore.js';

export const data = new SlashCommandBuilder()
  .setName('volume')
  .setDescription('Cambia el volumen de la reproducción actual.')
  .addIntegerOption((o) =>
    o.setName('nivel').setDescription(`Nivel de volumen (${MIN_VOLUME}-${MAX_VOLUME})`).setRequired(true).setMinValue(MIN_VOLUME).setMaxValue(MAX_VOLUME),
  )
  .setDMPermission(false);

export async function execute(interaction) {
  const { session, error } = requireActiveSessionInUserChannel(interaction);
  if (error) {
    await interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
    return;
  }

  const nivel = interaction.options.getInteger('nivel', true);
  const clamped = setVolume(session, nivel);
  await interaction.reply({ embeds: [buildVolumeChangedEmbed(clamped)] });
}
