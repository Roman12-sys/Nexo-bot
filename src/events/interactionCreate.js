import { MessageFlags } from 'discord.js';
import { routeButton } from '../components/buttons.js';
import { routeModal } from '../components/modals.js';
import { routeSelect } from '../components/selects.js';
import { checkRateLimit } from '../utils/rateLimiter.js';
import { trackCommandUsage, getTotalUsage } from '../utils/commandUsageStore.js';
import { checkCommandUsageAchievements } from '../utils/guildAchievements.js';

export const name = 'interactionCreate';
export const once = false;

// Fire-and-forget desde el dispatch de comandos: incrementa la métrica de uso y, con el
// total ya actualizado, chequea si el servidor cruzó algún umbral de logro colectivo.
// Nunca debe tirar ni demorar la respuesta real del comando.
async function trackUsageAndCheckAchievements(guildId, commandName, client) {
  try {
    await trackCommandUsage(guildId, commandName);
    if (!guildId) return;
    const total = await getTotalUsage(guildId);
    await checkCommandUsageAchievements(client, guildId, total);
  } catch (error) {
    console.error('❌ Error registrando uso de comando / logros de servidor:', error);
  }
}

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

  // Comandos "livianos" (sin costo real — un gif, una tirada de dados) tienen su propio
  // cupo, separado del resto — así jugar rápido a /8ball o /hug no gasta el cupo que
  // hace falta para un /ban o un /clear real. Ver rateLimiter.js.
  const command = interaction.isChatInputCommand() ? client.commands.get(interaction.commandName) : null;
  if (!checkRateLimit(interaction.user.id, command?.rateLimitCategory)) {
    const payload = { content: '⏳ Estás usando comandos muy rápido. Esperá unos segundos y probá de nuevo.', flags: MessageFlags.Ephemeral };
    await interaction.reply(payload).catch(() => {});
    return;
  }

  if (interaction.isChatInputCommand()) {
    if (!command) return;
    try {
      await command.execute(interaction, client);
      trackUsageAndCheckAchievements(interaction.guildId, interaction.commandName, client);
    } catch (error) {
      console.error(`Error ejecutando /${interaction.commandName}:`, error);
      const payload = { content: 'Hubo un error ejecutando este comando.', flags: MessageFlags.Ephemeral };
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
      let handled;
      if (interaction.isButton()) handled = await routeButton(interaction);
      else if (interaction.isModalSubmit()) handled = await routeModal(interaction);
      else handled = await routeSelect(interaction);

      // Ningún prefijo matcheó (botón/select/modal de un mensaje viejo, de antes de un
      // redeploy, o con un customId con typo) — sin esto la interacción quedaba sin
      // ninguna respuesta y Discord le mostraba "Esta interacción falló" al usuario sin
      // que quedara ningún rastro en consola para diagnosticarlo.
      if (!handled) {
        console.warn(`[WARN] Ninguna interacción registrada matcheó el customId "${interaction.customId}".`);
        const payload = { content: '⚠️ Este botón/menú ya no es válido (puede ser de un mensaje viejo).', flags: MessageFlags.Ephemeral };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(payload).catch(() => {});
        } else {
          await interaction.reply(payload).catch(() => {});
        }
      }
    } catch (error) {
      console.error(`Error procesando interacción ${interaction.customId}:`, error);
      const payload = { content: 'Hubo un error procesando esto.', flags: MessageFlags.Ephemeral };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
  }
}
