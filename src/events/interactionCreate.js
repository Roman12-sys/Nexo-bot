import { routeButton } from '../components/buttons.js';
import { routeModal } from '../components/modals.js';
import { routeSelect } from '../components/selects.js';

export const name = 'interactionCreate';
export const once = false;

export async function execute(interaction, client) {
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (!command?.autocomplete) return;
    try {
      await command.autocomplete(interaction);
    } catch (error) {
      // Un autocomplete interaction solo acepta .respond() (nunca .reply()), y una
      // sola vez — si algo falla, la mejor respuesta es "sin sugerencias", no dejar
      // la interacción sin responder (Discord la marca como fallida en el cliente).
      console.error(`Error en autocomplete de /${interaction.commandName}:`, error);
      await interaction.respond([]).catch(() => {});
    }
    return;
  }

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

  if (interaction.isButton() || interaction.isModalSubmit() || interaction.isAnySelectMenu()) {
    try {
      if (interaction.isButton()) await routeButton(interaction);
      else if (interaction.isModalSubmit()) await routeModal(interaction);
      else await routeSelect(interaction);
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
