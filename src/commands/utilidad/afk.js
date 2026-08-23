import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { setAfk, clearAfk } from '../../utils/afkStore.js';

export const data = new SlashCommandBuilder()
  .setName('afk')
  .setDescription('Te marca como ausente. Se te quita solo al escribir de nuevo (o con quitar:true).')
  .addStringOption((o) => o.setName('motivo').setDescription('Por qué estás ausente (opcional)').setRequired(false).setMaxLength(200))
  .addBooleanOption((o) => o.setName('quitar').setDescription('Quitarte el AFK ahora mismo, sin esperar a tu próximo mensaje').setRequired(false))
  .setDMPermission(false);

export async function execute(interaction) {
  // Antes la única forma de sacarse el AFK era escribir un mensaje — si alguien se
  // olvidaba y no escribía, quedaba marcado como ausente indefinidamente.
  if (interaction.options.getBoolean('quitar')) {
    const existed = clearAfk(interaction.guildId, interaction.user.id);
    await interaction.reply({
      content: existed ? '👋 Listo, ya no estás ausente.' : 'ℹ️ No estabas marcado como ausente.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const reason = interaction.options.getString('motivo') || 'Sin motivo especificado';
  setAfk(interaction.guildId, interaction.user.id, reason);
  await interaction.reply(`😴 ${interaction.user} ahora está ausente: ${reason}`);
}
