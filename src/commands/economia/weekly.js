// Bonus semanal, aparte de /daily — para quien no puede entrar todos los días pero sí
// una vez por semana. Mismo patrón exacto que daily.js (chequeo previo ephemeral +
// lock), sin racha (es un cooldown mucho más largo, no tiene sentido premiar consistencia
// dentro de la semana como sí hace /daily).
import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getUserEconomy, addBalance, setCooldown } from '../../utils/economyStore.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { withLock } from '../../utils/asyncLock.js';

export const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_REWARD = 1500;
const MAX_REWARD = 2500;

export const data = new SlashCommandBuilder()
  .setName('weekly')
  .setDescription('Reclamá tu recompensa semanal de monedas (mucho más grande que /daily, una vez por semana).')
  .setDMPermission(false);

export async function execute(interaction) {
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  const preCheck = await getUserEconomy(guildId, userId);
  if (Date.now() - preCheck.lastWeekly < COOLDOWN_MS) {
    const readyTimestamp = Math.floor((preCheck.lastWeekly + COOLDOWN_MS) / 1000);
    await interaction.reply({
      content: `⏳ Ya reclamaste tu recompensa semanal. Podés volver <t:${readyTimestamp}:R>.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();

  const result = await withLock(`weekly:${guildId}:${userId}`, async () => {
    const economy = await getUserEconomy(guildId, userId);
    const now = Date.now();
    const elapsed = now - economy.lastWeekly;

    if (elapsed < COOLDOWN_MS) {
      return { onCooldown: true, remaining: COOLDOWN_MS - elapsed, now };
    }

    const reward = Math.floor(Math.random() * (MAX_REWARD - MIN_REWARD + 1)) + MIN_REWARD;
    const newBalance = await addBalance(guildId, userId, reward, { type: 'weekly' });
    await setCooldown(guildId, userId, 'weekly', now);

    return { onCooldown: false, reward, newBalance };
  });

  if (result.onCooldown) {
    const readyTimestamp = Math.floor((result.now + result.remaining) / 1000);
    await interaction.editReply({ content: `⏳ Ya reclamaste tu recompensa semanal. Podés volver <t:${readyTimestamp}:R>.` });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🎁 Recompensa semanal')
    .setDescription(`Recibiste **${result.reward.toLocaleString('es-ES')}** monedas.\nTu nuevo balance: **${result.newBalance.toLocaleString('es-ES')}**.`)
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
