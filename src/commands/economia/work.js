import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getUserEconomy, addBalance, setCooldown } from '../../utils/economyStore.js';
import { getPet, getPetBonusMultiplier } from '../../utils/petsStore.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { withLock } from '../../utils/asyncLock.js';
import { unlockAchievement, announceUnlockedAchievements } from '../../utils/achievements.js';

export const COOLDOWN_MS = 60 * 60 * 1000; // 1 hora
const MIN_REWARD = 50;
const MAX_REWARD = 150;

const FLAVOR_TEXTS = [
  'Ayudaste a moderar el chat un rato y te dieron una propina.',
  'Jugaste una partida sponsoreada y ganaste un premio.',
  'Hiciste un stream corto y la comunidad te tiró unos bits.',
  'Vendiste un ítem viejo del inventario.',
  'Ganaste una apuesta amistosa con otro miembro del server.',
];

export const data = new SlashCommandBuilder()
  .setName('work')
  .setDescription('Trabajá para ganar monedas (cooldown más corto que /daily).')
  .setDMPermission(false);

export async function execute(interaction) {
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  // Chequeo previo ANTES de deferir: mismo motivo que /daily — permite responder
  // ephemeral en cooldown y evita arriesgar la ventana de 3s de Discord con el
  // round-trip a Supabase antes de la primera respuesta.
  const preCheck = await getUserEconomy(guildId, userId);
  if (Date.now() - preCheck.lastWork < COOLDOWN_MS) {
    const readyTimestamp = Math.floor((preCheck.lastWork + COOLDOWN_MS) / 1000);
    await interaction.reply({
      content: `⏳ Ya trabajaste hace poco. Podés volver a trabajar <t:${readyTimestamp}:R>.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();

  const result = await withLock(`work:${guildId}:${userId}`, async () => {
    const economy = await getUserEconomy(guildId, userId);
    const now = Date.now();
    const elapsed = now - economy.lastWork;

    if (elapsed < COOLDOWN_MS) {
      return { onCooldown: true, remaining: COOLDOWN_MS - elapsed, now };
    }

    const isFirstWork = economy.lastWork === 0;
    // Mascota bien alimentada y feliz (ver petsStore.js) da +10% — bonus chico, no
    // determinante, pero premia cuidarla en vez de dejarla como un cosmético más.
    const pet = await getPet(guildId, userId);
    const petBonus = getPetBonusMultiplier(pet);
    const baseReward = Math.floor(Math.random() * (MAX_REWARD - MIN_REWARD + 1)) + MIN_REWARD;
    const reward = Math.floor(baseReward * petBonus);
    const flavorText = FLAVOR_TEXTS[Math.floor(Math.random() * FLAVOR_TEXTS.length)];

    const newBalance = await addBalance(guildId, userId, reward, { type: 'work', reason: flavorText });
    await setCooldown(guildId, userId, 'work', now);

    return { onCooldown: false, reward, flavorText, newBalance, isFirstWork, petBonusActive: petBonus > 1 };
  });

  if (result.onCooldown) {
    const readyTimestamp = Math.floor((result.now + result.remaining) / 1000);
    await interaction.editReply({
      content: `⏳ Ya trabajaste hace poco. Podés volver a trabajar <t:${readyTimestamp}:R>.`,
    });
    return;
  }

  const { reward, flavorText, newBalance, isFirstWork, petBonusActive } = result;
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('💼 A trabajar')
    .setDescription(
      `${flavorText}\n\nGanaste **${reward.toLocaleString('es-ES')}** monedas.${petBonusActive ? ' (🐾 +10% por tu mascota)' : ''}\nTu nuevo balance: **${newBalance.toLocaleString('es-ES')}**.`,
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });

  await announceUnlockedAchievements(interaction, userId, [
    isFirstWork ? unlockAchievement(guildId, userId, 'a_laburar') : null,
    newBalance >= 10000 ? unlockAchievement(guildId, userId, 'millonario') : null,
  ]);
}
