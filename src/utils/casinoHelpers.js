// Lógica compartida de "apostar y resolver" para /slots, /ruleta y /dado — mismo patrón
// que ya usaba /coinflip (chequeo previo, defer, lock, deductBalanceIfSufficient) pero
// factorizado acá porque con 3 comandos más se volvía la misma cascada copiada 3 veces.
// /coinflip queda como está (ya funciona, no hay motivo para tocarlo).
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { getUserEconomy, deductBalanceIfSufficient, addBalance, recordTransaction } from './economyStore.js';
import { withLock } from './asyncLock.js';
import { BRAND_COLOR, BRAND_NAME } from './embeds.js';

const OUTCOME_COLOR = { win: BRAND_COLOR, push: '#8D99AE', lose: '#c22b3f' };

// resolve() -> { outcome: 'win'|'push'|'lose', payout (total a devolver, 0 si perdió
// todo), title, description }. gameKey identifica el juego para el lock y el motivo
// que queda en el historial de /economia-staff.
export async function playCasinoGame(interaction, { apuesta, gameKey, gameLabel, resolve }) {
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  const preCheck = await getUserEconomy(guildId, userId);
  if (preCheck.balance < apuesta) {
    await interaction.reply({ content: `❌ No tenés suficientes monedas. Tu balance: **${preCheck.balance.toLocaleString('es-ES')}**.`, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply();

  await withLock(`${gameKey}:${guildId}:${userId}`, async () => {
    let balanceAfterBet;
    try {
      balanceAfterBet = await deductBalanceIfSufficient(guildId, userId, apuesta);
    } catch (error) {
      if (error.code === 'insufficient_funds') {
        await interaction.editReply({ content: '❌ No tenés suficientes monedas para esa apuesta.' });
        return;
      }
      throw error;
    }

    const result = resolve();
    await recordTransaction(guildId, userId, { type: 'gamble_bet', amount: -apuesta, balanceAfter: balanceAfterBet, reason: gameLabel });

    let finalBalance = balanceAfterBet;
    if (result.payout > 0) {
      // QUÉ CAMBIÓ (Fase A, segunda auditoría 2026-08-30): se agrega `netGain`. El
      // payout es bruto (ej. coinflip devuelve 2x la apuesta) — sin esto, ganar una
      // apuesta de 1.000 por 2.000 se contaba como "ganaste 2.000 monedas" en misiones y
      // en guild_daily_stats.money_created, cuando la ganancia real es 1.000. El balance
      // en sí no cambia: sigue acreditándose el payout completo.
      finalBalance = await addBalance(guildId, userId, result.payout, { type: 'gamble_win', reason: gameLabel, netGain: result.payout - apuesta });
    }

    const embed = new EmbedBuilder()
      .setColor(OUTCOME_COLOR[result.outcome])
      .setTitle(result.title)
      .setDescription(`${result.description}\nBalance: **${finalBalance.toLocaleString('es-ES')}**.`)
      .setFooter({ text: BRAND_NAME })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  });
}

// Elige un elemento de "items" ({value, weight}[]) al azar, respetando los pesos —
// usado por /slots para que los símbolos raros salgan menos seguido.
export function weightedRandom(items) {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}
