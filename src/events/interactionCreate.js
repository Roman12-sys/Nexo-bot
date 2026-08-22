import { routeButton } from '../components/buttons.js';
import { routeModal } from '../components/modals.js';

export const name = 'interactionCreate';
export const once = false;

export async function execute(interaction, client) {
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction, client);
    } catch (error) {
      console.error(`Error ejecutando /${interaction.commandName}:`, error);
      const payload = { content: 'Hubo un error ejecutando este comando.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
    return;
  }

  if (interaction.isButton() || interaction.isModalSubmit()) {
    try {
      if (interaction.isButton()) await routeButton(interaction);
      else await routeModal(interaction);
    } catch (error) {
      console.error(`Error procesando interacción ${interaction.customId}:`, error);
      const payload = { content: 'Hubo un error procesando esto.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
  }
}
