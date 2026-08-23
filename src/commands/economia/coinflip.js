// Primer comando de la economía con riesgo real — /daily, /work y hasta la caja
// misteriosa de /buy siempre "ganan algo". 50/50 limpio, sin ventaja de la casa: quien
// gana se lleva el doble de lo que apostó, quien pierde pierde exactamente eso.
import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getUserEconomy, deductBalanceIfSufficient, addBalance, recordTransaction } from '../../utils/economyStore.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { withLock } from '../../utils/asyncLock.js';

const CHOICES = { cara: 'Cara', cruz: 'Cruz' };

export const data = new SlashCommandBuilder()
  .setName('coinflip')
  .setDescription('Apostá monedas a cara o cruz. 50/50, sin ventaja de la casa.')
  .addIntegerOption((o) => o.setName('apuesta').setDescription('Cuántas monedas apostar').setRequired(true).setMinValue(10))
  .addStringOption((o) =>
    o
      .setName('eleccion')
      .setDescription('A qué le apostás')
      .setRequired(true)
      .addChoices({ name: 'Cara', value: 'cara' }, { name: 'Cruz', value: 'cruz' }),
  )
  .setDMPermission(false);

export async function execute(interaction) {
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const apuesta = interaction.options.getInteger('apuesta');
  const eleccion = interaction.options.getString('eleccion');

  // Chequeo previo ANTES de deferir: mismo motivo que /daily, /work, /buy — permite
  // responder ephemeral si no alcanza, y evita arriesgar la ventana de 3s de Discord
  // con el round-trip a Supabase antes de la primera respuesta.
  const preCheck = await getUserEconomy(guildId, userId);
  if (preCheck.balance < apuesta) {
    await interaction.reply({ content: `❌ No tenés suficientes monedas. Tu balance: **${preCheck.balance.toLocaleString('es-ES')}**.`, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply();

  await withLock(`coinflip:${guildId}:${userId}`, async () => {
    // deductBalanceIfSufficient cobra la apuesta en una sola sentencia atómica: si el
    // balance bajó entre el chequeo de arriba y este punto (otro comando concurrente),
    // rechaza sin descontar nada en vez de dejar el balance en negativo.
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
    await recordTransaction(guildId, userId, {
      type: 'gamble_bet',
      amount: -apuesta,
      balanceAfter: balanceAfterBet,
      reason: `Coinflip: apostaste a ${CHOICES[eleccion]}`,
    });

    const resultado = Math.random() < 0.5 ? 'cara' : 'cruz';
    const gano = resultado === eleccion;

    if (!gano) {
      const embed = new EmbedBuilder()
        .setColor('#c22b3f')
        .setTitle('🪙 Coinflip — perdiste')
        .setDescription(`Salió **${CHOICES[resultado]}**. Perdiste **${apuesta.toLocaleString('es-ES')}** monedas.\nBalance: **${balanceAfterBet.toLocaleString('es-ES')}**.`)
        .setFooter({ text: BRAND_NAME })
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const finalBalance = await addBalance(guildId, userId, apuesta * 2, {
      type: 'gamble_win',
      reason: `Coinflip: salió ${CHOICES[resultado]}`,
    });

    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle('🪙 Coinflip — ¡ganaste!')
      .setDescription(`Salió **${CHOICES[resultado]}**. Ganaste **${apuesta.toLocaleString('es-ES')}** monedas.\nBalance: **${finalBalance.toLocaleString('es-ES')}**.`)
      .setFooter({ text: BRAND_NAME })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  });
}
