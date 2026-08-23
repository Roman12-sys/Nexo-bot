import { SlashCommandBuilder } from 'discord.js';
import { playCasinoGame } from '../../utils/casinoHelpers.js';

export const data = new SlashCommandBuilder()
  .setName('dado')
  .setDescription('Duelo de dados contra el bot (1-100). Quien saque más alto gana. Empate devuelve la apuesta.')
  .addIntegerOption((o) => o.setName('apuesta').setDescription('Cuántas monedas apostar').setRequired(true).setMinValue(10))
  .setDMPermission(false);

export async function execute(interaction) {
  const apuesta = interaction.options.getInteger('apuesta');

  await playCasinoGame(interaction, {
    apuesta,
    gameKey: 'dado',
    gameLabel: 'Dado',
    resolve: () => {
      const tuyo = Math.floor(Math.random() * 100) + 1;
      const bot = Math.floor(Math.random() * 100) + 1;
      const linea = `🎲 Vos: **${tuyo}**  ·  🤖 Bot: **${bot}**`;

      if (tuyo > bot) {
        const payout = apuesta * 2;
        return { outcome: 'win', payout, title: '🎲 ¡Ganaste!', description: `${linea}\nGanaste **${payout.toLocaleString('es-ES')}** monedas.` };
      }
      if (tuyo === bot) {
        return { outcome: 'push', payout: apuesta, title: '🎲 Empate', description: `${linea}\nRecuperaste tu apuesta.` };
      }
      return { outcome: 'lose', payout: 0, title: '🎲 Perdiste', description: `${linea}\nPerdiste **${apuesta.toLocaleString('es-ES')}** monedas.` };
    },
  });
}
