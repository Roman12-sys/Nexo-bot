import { SlashCommandBuilder } from 'discord.js';
import { setAfk } from '../../utils/afkStore.js';

export const data = new SlashCommandBuilder()
  .setName('afk')
  .setDescription('Te marca como ausente. Se te quita solo al escribir de nuevo.')
  .addStringOption((o) => o.setName('motivo').setDescription('Por qué estás ausente (opcional)').setRequired(false).setMaxLength(200))
  .setDMPermission(false);

export async function execute(interaction) {
  const reason = interaction.options.getString('motivo') || 'Sin motivo especificado';
  setAfk(interaction.guildId, interaction.user.id, reason);
  await interaction.reply(`😴 ${interaction.user} ahora está ausente: ${reason}`);
}
