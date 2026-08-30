import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { requireActiveSessionInUserChannel } from '../../utils/musicPermissions.js';
import { destroySession } from '../../utils/musicEngine.js';

// Cubre también lo que antes era /disconnect: detener y desconectar son la misma
// operación acá (destroySession) — separarlos en dos comandos hubiera sumado uno más al
// total de comandos globales del bot por un matiz que no cambia el comportamiento real.
export const data = new SlashCommandBuilder()
  .setName('stop')
  .setDescription('Detiene la reproducción, vacía la cola y desconecta al bot del canal de voz.')
  .setDMPermission(false);

export async function execute(interaction) {
  const { session, error } = requireActiveSessionInUserChannel(interaction);
  if (error) {
    await interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
    return;
  }

  // Ack liviano y efímero: el panel de control (si existe) ya se edita solo a su estado
  // final con el motivo — un embed público acá sería el mismo aviso dos veces.
  await interaction.reply({ content: '⏹️ Reproducción detenida.', flags: MessageFlags.Ephemeral });
  destroySession(session.guildId, `Detenido por <@${interaction.user.id}>.`);
}
