import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getUserEconomy, addBalance, setCooldown } from '../../utils/economyStore.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { withLock } from '../../utils/asyncLock.js';

const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MIN_REWARD = 100;
const MAX_REWARD = 300;

export const data = new SlashCommandBuilder()
  .setName('daily')
  .setDescription('Reclamá tu recompensa diaria de monedas.')
  .setDMPermission(false);

export async function execute(interaction) {
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  const result = await withLock(`daily:${guildId}:${userId}`, async () => {
    const economy = await getUserEconomy(guildId, userId);
    const now = Date.now();
    const elapsed = now - economy.lastDaily;

    if (elapsed < COOLDOWN_MS) {
      return { onCooldown: true, remaining: COOLDOWN_MS - elapsed, now };
    }

    const reward = Math.floor(Math.random() * (MAX_REWARD - MIN_REWARD + 1)) + MIN_REWARD;

    const newBalance = await addBalance(guildId, userId, reward, { type: 'daily' });
    await setCooldown(guildId, userId, 'daily', now);

    return { onCooldown: false, reward, newBalance };
  });

  if (result.onCooldown) {
    const readyTimestamp = Math.floor((result.now + result.remaining) / 1000);
    await interaction.reply({
      content: `⏳ Ya reclamaste tu recompensa diaria. Podés volver <t:${readyTimestamp}:R>.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { reward, newBalance } = result;
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🎁 Recompensa diaria')
    .setDescription(`Recibiste **${reward.toLocaleString('es-ES')}** monedas.\nTu nuevo balance: **${newBalance.toLocaleString('es-ES')}**.`)
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
