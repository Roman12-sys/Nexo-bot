import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { requireActiveSessionInUserChannel } from '../../utils/musicPermissions.js';
import { setLoopMode } from '../../utils/musicEngine.js';
import { buildLoopChangedEmbed } from '../../utils/musicEmbeds.js';

export const data = new SlashCommandBuilder()
  .setName('loop')
  .setDescription('Cambia el modo de repetición.')
  .addStringOption((o) =>
    o
      .setName('modo')
      .setDescription('Modo de repetición')
      .setRequired(true)
      .addChoices({ name: 'Desactivado', value: 'off' }, { name: 'Canción actual', value: 'track' }, { name: 'Cola completa', value: 'queue' }),
  )
  .setDMPermission(false);

export async function execute(interaction) {
  const { session, error } = requireActiveSessionInUserChannel(interaction);
  if (error) {
    await interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
    return;
  }

  const modo = interaction.options.getString('modo', true);
  setLoopMode(session, modo);
  await interaction.reply({ embeds: [buildLoopChangedEmbed(modo)] });
}
