// Alternativa a /work con más riesgo: cooldown más corto y mejor paga, pero con chance
// de que te agarren y pierdas monedas — a diferencia de la multa de /rob (que va a la
// víctima), esta se pierde directamente: es un sumidero real para una economía que hoy
// solo se vacía comprando en la tienda.
import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getUserEconomy, addBalance, deductBalanceIfSufficient, recordTransaction, setCooldown } from '../../utils/economyStore.js';
import { getPet, getPetBonusMultiplier } from '../../utils/petsStore.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { withLock } from '../../utils/asyncLock.js';

export const COOLDOWN_MS = 45 * 60 * 1000; // 45 minutos
const SUCCESS_CHANCE = 0.6;
const MIN_REWARD = 150;
const MAX_REWARD = 400;
const MIN_FINE = 50;
const MAX_FINE = 150;

const SUCCESS_TEXTS = [
  'Le afanaste la billetera a un turista distraído.',
  'Vendiste "mercadería" de dudosa procedencia sin que nadie sospechara.',
  'Hackeaste una cuenta bancaria vieja y te llevaste una parte.',
  'Organizaste una estafa piramidal exprés y saliste a tiempo.',
];
const FAIL_TEXTS = [
  'Te agarró la seguridad antes de terminar.',
  'Alguien te reconoció y avisó a la policía.',
  'La víctima se resistió y tuviste que pagar para que no dijera nada.',
  'Te delató un cómplice.',
];

export const data = new SlashCommandBuilder()
  .setName('crime')
  .setDescription('Alternativa a /work con más riesgo: mejor paga, cooldown más corto, chance de perder monedas.')
  .setDMPermission(false);

export async function execute(interaction) {
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  const preCheck = await getUserEconomy(guildId, userId);
  if (Date.now() - preCheck.lastCrime < COOLDOWN_MS) {
    const readyTimestamp = Math.floor((preCheck.lastCrime + COOLDOWN_MS) / 1000);
    await interaction.reply({
      content: `⏳ Todavía estás escondido de tu último golpe. Podés volver a intentar <t:${readyTimestamp}:R>.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();

  const result = await withLock(`crime:${guildId}:${userId}`, async () => {
    const economy = await getUserEconomy(guildId, userId);
    const now = Date.now();
    const elapsed = now - economy.lastCrime;

    if (elapsed < COOLDOWN_MS) {
      return { onCooldown: true, remaining: COOLDOWN_MS - elapsed, now };
    }

    await setCooldown(guildId, userId, 'crime', now);
    const exito = Math.random() < SUCCESS_CHANCE;

    if (exito) {
      const pet = await getPet(guildId, userId);
      const petBonus = getPetBonusMultiplier(pet);
      const baseReward = Math.floor(Math.random() * (MAX_REWARD - MIN_REWARD + 1)) + MIN_REWARD;
      const reward = Math.floor(baseReward * petBonus);
      const flavorText = SUCCESS_TEXTS[Math.floor(Math.random() * SUCCESS_TEXTS.length)];
      const newBalance = await addBalance(guildId, userId, reward, { type: 'crime_win', reason: flavorText });
      return { onCooldown: false, exito: true, amount: reward, flavorText, newBalance, petBonusActive: petBonus > 1 };
    }

    const fine = Math.floor(Math.random() * (MAX_FINE - MIN_FINE + 1)) + MIN_FINE;
    const flavorText = FAIL_TEXTS[Math.floor(Math.random() * FAIL_TEXTS.length)];

    // La multa se limita a lo que tenga — deductBalanceIfSufficient con el mínimo entre
    // la multa y el balance actual, para no dejar a nadie en negativo por fallar.
    const currentEconomy = await getUserEconomy(guildId, userId);
    const actualFine = Math.min(fine, currentEconomy.balance);
    let newBalance = currentEconomy.balance;
    if (actualFine > 0) {
      newBalance = await deductBalanceIfSufficient(guildId, userId, actualFine);
      await recordTransaction(guildId, userId, { type: 'crime_fine', amount: -actualFine, balanceAfter: newBalance, reason: flavorText });
    }
    return { onCooldown: false, exito: false, amount: actualFine, flavorText, newBalance };
  });

  if (result.onCooldown) {
    const readyTimestamp = Math.floor((result.now + result.remaining) / 1000);
    await interaction.editReply({ content: `⏳ Todavía estás escondido de tu último golpe. Podés volver a intentar <t:${readyTimestamp}:R>.` });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(result.exito ? BRAND_COLOR : '#c22b3f')
    .setTitle(result.exito ? '🕵️ Golpe exitoso' : '🚨 Te agarraron')
    .setDescription(
      result.exito
        ? `${result.flavorText}\n\nGanaste **${result.amount.toLocaleString('es-ES')}** monedas.${result.petBonusActive ? ' (🐾 +10% por tu mascota)' : ''}\nBalance: **${result.newBalance.toLocaleString('es-ES')}**.`
        : `${result.flavorText}${result.amount > 0 ? `\n\nPerdiste **${result.amount.toLocaleString('es-ES')}** monedas de multa.` : '\n\nPor suerte no tenías nada que perder.'}\nBalance: **${result.newBalance.toLocaleString('es-ES')}**.`,
    )
    .setFooter({ text: `${BRAND_NAME} • ${Math.round(SUCCESS_CHANCE * 100)}% de éxito` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
