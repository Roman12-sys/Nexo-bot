import { SlashCommandBuilder } from 'discord.js';
import { playCasinoGame, weightedRandom } from '../../utils/casinoHelpers.js';

// Símbolos más comunes pagan menos, los raros pagan más — mismo criterio que cualquier
// tragamonedas real. Pesos suman 100 (son porcentajes directos).
const SYMBOLS = [
  { emoji: '🍒', weight: 30, payout: 3 },
  { emoji: '🍋', weight: 25, payout: 3 },
  { emoji: '🍊', weight: 20, payout: 4 },
  { emoji: '🍇', weight: 15, payout: 5 },
  { emoji: '💎', weight: 7, payout: 8 },
  { emoji: '7️⃣', weight: 3, payout: 15 },
];

export const data = new SlashCommandBuilder()
  .setName('slots')
  .setDescription('Tragamonedas: 3 símbolos iguales pagan según cuál sea, 2 iguales te devuelve la apuesta.')
  .addIntegerOption((o) => o.setName('apuesta').setDescription('Cuántas monedas apostar').setRequired(true).setMinValue(10))
  .setDMPermission(false);

export async function execute(interaction) {
  const apuesta = interaction.options.getInteger('apuesta');

  await playCasinoGame(interaction, {
    apuesta,
    gameKey: 'slots',
    gameLabel: 'Slots',
    resolve: () => {
      const reels = [weightedRandom(SYMBOLS), weightedRandom(SYMBOLS), weightedRandom(SYMBOLS)];
      const display = `【 ${reels.map((r) => r.emoji).join(' | ')} 】`;

      if (reels[0].emoji === reels[1].emoji && reels[1].emoji === reels[2].emoji) {
        const payout = apuesta * reels[0].payout;
        return {
          outcome: 'win',
          payout,
          title: '🎰 ¡Tres iguales!',
          description: `${display}\nGanaste **${payout.toLocaleString('es-ES')}** monedas (x${reels[0].payout}).`,
        };
      }

      if (reels[0].emoji === reels[1].emoji || reels[1].emoji === reels[2].emoji || reels[0].emoji === reels[2].emoji) {
        return {
          outcome: 'push',
          payout: apuesta,
          title: '🎰 Dos iguales',
          description: `${display}\nNo ganaste ni perdiste — recuperaste tu apuesta.`,
        };
      }

      return {
        outcome: 'lose',
        payout: 0,
        title: '🎰 Sin suerte',
        description: `${display}\nPerdiste **${apuesta.toLocaleString('es-ES')}** monedas.`,
      };
    },
  });
}
