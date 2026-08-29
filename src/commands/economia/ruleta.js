// QUÉ CAMBIÓ: PAYOUT.verde subió de 14 a 30 (constante, sin tocar spin()/resolve()).
// MOTIVO: auditoría 2026-08-29 (Diagnóstico Nexo, Parte 4) — con x14, apostar a rojo/
// negro (18/37 de chance, paga x2) dejaba un house edge de ~2.70%, mientras que apostar
// a verde (1/37, pagaba x14) dejaba ~62.16%. Ese salto dentro del mismo comando no
// seguía la progresión de riesgo del resto del casino (0% → 0% → 2.70% → 32%) y leía
// como un pago mal calibrado, no una decisión de diseño. Con x30 el edge de verde baja
// a ~18.92% ((1/37)*30=30/37≈0.811), un escalón intermedio y coherente entre rojo/negro
// y slots.
// VERIFICACIÓN: setDefaultMemberPermissions no cambia; confirmar que la descripción del
// comando y el choice de "verde" digan x30 (no x14) antes de correr /deploy-commands.
import { SlashCommandBuilder } from 'discord.js';
import { playCasinoGame } from '../../utils/casinoHelpers.js';

// Ruleta europea (un solo cero) simplificada a color — sin apuesta a número exacto para
// que sea rápida de jugar. Números rojos reales de la ruleta europea; el resto (menos el
// 0, que es verde) es negro.
const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const PAYOUT = { rojo: 2, negro: 2, verde: 30 };

function spin() {
  const number = Math.floor(Math.random() * 37); // 0-36
  const color = number === 0 ? 'verde' : RED_NUMBERS.has(number) ? 'rojo' : 'negro';
  return { number, color };
}

export const data = new SlashCommandBuilder()
  .setName('ruleta')
  .setDescription('Apostá a un color. Rojo/negro pagan x2, verde (el 0) paga x30.')
  .addIntegerOption((o) => o.setName('apuesta').setDescription('Cuántas monedas apostar').setRequired(true).setMinValue(10).setMaxValue(100000))
  .addStringOption((o) =>
    o
      .setName('color')
      .setDescription('A qué color apostás')
      .setRequired(true)
      .addChoices({ name: '🔴 Rojo (x2)', value: 'rojo' }, { name: '⚫ Negro (x2)', value: 'negro' }, { name: '🟢 Verde — el 0 (x30)', value: 'verde' }),
  )
  .setDMPermission(false);

export async function execute(interaction) {
  const apuesta = interaction.options.getInteger('apuesta');
  const color = interaction.options.getString('color');

  await playCasinoGame(interaction, {
    apuesta,
    gameKey: 'ruleta',
    gameLabel: 'Ruleta',
    resolve: () => {
      const result = spin();
      const colorEmoji = { rojo: '🔴', negro: '⚫', verde: '🟢' };

      if (result.color === color) {
        const payout = apuesta * PAYOUT[color];
        return {
          outcome: 'win',
          payout,
          title: '🎡 ¡Ganaste!',
          description: `Salió **${result.number} ${colorEmoji[result.color]}**.\nGanaste **${payout.toLocaleString('es-ES')}** monedas (x${PAYOUT[color]}).`,
        };
      }

      return {
        outcome: 'lose',
        payout: 0,
        title: '🎡 Perdiste',
        description: `Salió **${result.number} ${colorEmoji[result.color]}**.\nPerdiste **${apuesta.toLocaleString('es-ES')}** monedas.`,
      };
    },
  });
}
