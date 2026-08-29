// QUÉ CAMBIÓ: /coinflip pasó a usar playCasinoGame (casinoHelpers.js), el mismo motor
// que ya usan /dado, /slots y /ruleta, en vez de reimplementar su propio flujo de
// precheck/defer/lock/cobro/pago.
// MOTIVO: auditoría 2026-08-29 (Diagnóstico Nexo, Parte 4 y Parte 22) — coinflip.js era
// el único de los cuatro juegos que no usaba casinoHelpers.js, duplicando ~50 líneas de
// una lógica ya centralizada. casinoHelpers.playCasinoGame ya aceptaba exactamente el
// contrato que coinflip necesita (resolve() -> {outcome, payout, title, description}),
// así que no hizo falta tocar casinoHelpers.js para nada.
// COMPORTAMIENTO OBSERVABLE — sin cambios, verificado línea por línea contra el original:
//   - Sigue siendo 50/50 exacto (Math.random() < 0.5).
//   - Payout ganador sigue siendo apuesta*2. EV = 0.5*(+apuesta) + 0.5*(-apuesta) = 0.
//   - Mismo mínimo/máximo de apuesta (10 / 100.000), misma respuesta ephemeral si no
//     alcanza el saldo, mismo texto de resultado ("Salió **Cara/Cruz**...").
// DIFERENCIA MENOR (no de comportamiento hacia el usuario): el motivo que queda en el
// historial de /economia-staff pasa de "Coinflip: apostaste a X" / "Coinflip: salió Y"
// a un "Coinflip" plano — mismo criterio que ya usan /dado y /ruleta (gameLabel fijo),
// no algo que el jugador vea en ningún momento.
// VERIFICACIÓN: correr /coinflip varias veces y confirmar que paga exactamente el doble
// de la apuesta al ganar, cero al perder, y que el balance mostrado coincide con lo que
// ya hacían /dado y /ruleta tras el cobro.
import { SlashCommandBuilder } from 'discord.js';
import { playCasinoGame } from '../../utils/casinoHelpers.js';

const CHOICES = { cara: 'Cara', cruz: 'Cruz' };

export const data = new SlashCommandBuilder()
  .setName('coinflip')
  .setDescription('Apostá monedas a cara o cruz. 50/50, sin ventaja de la casa.')
  .addIntegerOption((o) => o.setName('apuesta').setDescription('Cuántas monedas apostar').setRequired(true).setMinValue(10).setMaxValue(100000))
  .addStringOption((o) =>
    o
      .setName('eleccion')
      .setDescription('A qué le apostás')
      .setRequired(true)
      .addChoices({ name: 'Cara', value: 'cara' }, { name: 'Cruz', value: 'cruz' }),
  )
  .setDMPermission(false);

export async function execute(interaction) {
  const apuesta = interaction.options.getInteger('apuesta');
  const eleccion = interaction.options.getString('eleccion');

  await playCasinoGame(interaction, {
    apuesta,
    gameKey: 'coinflip',
    gameLabel: 'Coinflip',
    resolve: () => {
      const resultado = Math.random() < 0.5 ? 'cara' : 'cruz';
      const linea = `Salió **${CHOICES[resultado]}**.`;

      if (resultado === eleccion) {
        const payout = apuesta * 2;
        return { outcome: 'win', payout, title: '🪙 Coinflip — ¡ganaste!', description: `${linea}\nGanaste **${payout.toLocaleString('es-ES')}** monedas.` };
      }

      return { outcome: 'lose', payout: 0, title: '🪙 Coinflip — perdiste', description: `${linea}\nPerdiste **${apuesta.toLocaleString('es-ES')}** monedas.` };
    },
  });
}
