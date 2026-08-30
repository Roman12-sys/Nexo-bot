import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getUserEconomy, addBalance, setDailyClaim } from '../../utils/economyStore.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { withLock } from '../../utils/asyncLock.js';
import { eventBus } from '../../utils/eventBus.js'; // Event Engine — auditoría 2026-08-29, Parte 7

export const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MIN_REWARD = 100;
const MAX_REWARD = 300;
// Bonus por racha: +10 monedas por día consecutivo, tope en el día 31 (+300) para que
// no crezca sin límite. La racha se corta si pasan más de 48hs desde el último /daily
// (24hs de cooldown + 24hs de margen — un día de gracia antes de perderla del todo).
const STREAK_BONUS_PER_DAY = 10;
const STREAK_BONUS_CAP_DAYS = 30;
const STREAK_GRACE_MS = COOLDOWN_MS * 2;

export const data = new SlashCommandBuilder()
  .setName('daily')
  .setDescription('Reclamá tu recompensa diaria de monedas.')
  .setDMPermission(false);

export async function execute(interaction) {
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  // Chequeo previo ANTES de deferir: así "todavía en cooldown" puede responderse
  // ephemeral (una vez deferido en público, ya no se puede cambiar). El chequeo real
  // y autoritativo sigue pasando adentro del lock, más abajo — esto es solo para
  // decidir cómo responder, y para no arriesgar la ventana de 3s de Discord con el
  // round-trip a Supabase antes de la primera respuesta.
  const preCheck = await getUserEconomy(guildId, userId);
  if (Date.now() - preCheck.lastDaily < COOLDOWN_MS) {
    const readyTimestamp = Math.floor((preCheck.lastDaily + COOLDOWN_MS) / 1000);
    await interaction.reply({
      content: `⏳ Ya reclamaste tu recompensa diaria. Podés volver <t:${readyTimestamp}:R>.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();

  const result = await withLock(`daily:${guildId}:${userId}`, async () => {
    const economy = await getUserEconomy(guildId, userId);
    const now = Date.now();
    const elapsed = now - economy.lastDaily;

    if (elapsed < COOLDOWN_MS) {
      return { onCooldown: true, remaining: COOLDOWN_MS - elapsed, now };
    }

    const isFirstDaily = economy.lastDaily === 0;
    // Sigue la racha si el /daily anterior fue hace menos de 48hs (adentro de la ventana
    // de gracia); si pasó más tiempo que eso, se perdió y arranca de nuevo en 1.
    const continuesStreak = !isFirstDaily && elapsed < STREAK_GRACE_MS;
    const streak = isFirstDaily ? 1 : continuesStreak ? economy.dailyStreak + 1 : 1;
    const streakBonus = Math.min(streak - 1, STREAK_BONUS_CAP_DAYS) * STREAK_BONUS_PER_DAY;
    const baseReward = Math.floor(Math.random() * (MAX_REWARD - MIN_REWARD + 1)) + MIN_REWARD;
    const reward = baseReward + streakBonus;

    const newBalance = await addBalance(guildId, userId, reward, {
      type: 'daily',
      reason: streakBonus > 0 ? `Racha de ${streak} días (+${streakBonus} bonus)` : undefined,
    });
    await setDailyClaim(guildId, userId, { timestamp: now, streak });

    return { onCooldown: false, reward, streak, streakBonus, newBalance, isFirstDaily };
  });

  if (result.onCooldown) {
    const readyTimestamp = Math.floor((result.now + result.remaining) / 1000);
    await interaction.editReply({
      content: `⏳ Ya reclamaste tu recompensa diaria. Podés volver <t:${readyTimestamp}:R>.`,
    });
    return;
  }

  const { reward, streak, streakBonus, newBalance, isFirstDaily } = result;
  const streakLine = streak > 1 ? `\n🔥 Racha: **${streak}** días seguidos (+${streakBonus} de bonus)` : '';
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🎁 Recompensa diaria')
    .setDescription(`Recibiste **${reward.toLocaleString('es-ES')}** monedas.${streakLine}\nTu nuevo balance: **${newBalance.toLocaleString('es-ES')}**.`)
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });

  if (isFirstDaily) await eventBus.emit('ACHIEVEMENT_CHECK', { guildId, userId, achievementId: 'primera_moneda', interaction });
  if (newBalance >= 10000) await eventBus.emit('ACHIEVEMENT_CHECK', { guildId, userId, achievementId: 'millonario', interaction });
}
