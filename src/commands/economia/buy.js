import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getGuildShopItems, getShopItem } from '../../utils/shopStore.js';
import { getUserEconomy, deductBalanceIfSufficient, incrementInventoryItem, addBalance, recordTransaction } from '../../utils/economyStore.js';
import { createShopPurchaseLogEmbed } from '../../utils/logEmbeds.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';
import { unlockAchievement, announceUnlockedAchievements } from '../../utils/achievements.js';

const MIN_MYSTERY = 50;
const MAX_MYSTERY = 600;

export const data = new SlashCommandBuilder()
  .setName('buy')
  .setDescription('Comprá un ítem de la tienda.')
  .addStringOption((o) => o.setName('item').setDescription('Qué ítem querés comprar (escribí para buscar)').setRequired(true).setAutocomplete(true))
  .setDMPermission(false);

// El catálogo es por servidor, así que las opciones no pueden ser fijas al momento
// del deploy (como sería con .addChoices) — se resuelven acá, en vivo, con lo que
// el usuario ya escribió.
export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const items = await getGuildShopItems(interaction.guildId).catch(() => []);
  const matches = items
    .filter((item) => item.name.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((item) => ({ name: `${item.name} (${item.price.toLocaleString('es-ES')} monedas)`.slice(0, 100), value: item.id }));

  await interaction.respond(matches);
}

export async function execute(interaction) {
  const itemId = interaction.options.getString('item');
  const item = await getShopItem(interaction.guildId, itemId);

  if (!item) {
    await interaction.reply({ content: '❌ Ese ítem no existe. Elegilo de las sugerencias mientras escribís.', flags: MessageFlags.Ephemeral });
    return;
  }

  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  // Si el ítem da un rol y ya lo tenés, cortamos ANTES de cobrar — comprarlo de nuevo
  // sería un cargo por nada (el roles.add de más abajo es un no-op si ya lo tenés).
  let member = null;
  if (item.roleId) {
    member = await interaction.guild.members.fetch(userId).catch(() => null);
    if (member?.roles.cache.has(item.roleId)) {
      await interaction.reply({ content: `⚠️ Ya tenés **${item.name}**.`, flags: MessageFlags.Ephemeral });
      return;
    }
  }

  await interaction.deferReply();

  // deductBalanceIfSufficient cobra en una sola sentencia atómica: si no alcanza,
  // rechaza sin descontar nada (dos compras simultáneas del mismo usuario ya no pueden
  // cobrar dos veces con fondos que solo alcanzaban para una).
  let balanceAfterCharge;
  try {
    balanceAfterCharge = await deductBalanceIfSufficient(guildId, userId, item.price);
  } catch (error) {
    if (error.code === 'insufficient_funds') {
      const economy = await getUserEconomy(guildId, userId);
      const faltante = item.price - economy.balance;
      await interaction.editReply({ content: `❌ No tenés suficientes monedas. Te faltan **${faltante.toLocaleString('es-ES')}**.` });
      return;
    }
    throw error;
  }
  await recordTransaction(guildId, userId, { type: 'purchase', amount: -item.price, balanceAfter: balanceAfterCharge, reason: item.name });
  const firstPurchaseAchievement = unlockAchievement(guildId, userId, 'primera_compra');

  // --- Caso especial: caja misteriosa (solo existe en el catálogo por defecto) ---
  // No se guarda en el inventario, se resuelve al instante con una recompensa al azar
  if (item.type === 'mystery_box') {
    const reward = Math.floor(Math.random() * (MAX_MYSTERY - MIN_MYSTERY + 1)) + MIN_MYSTERY;
    const finalBalance = await addBalance(guildId, userId, reward, { type: 'mystery_box', reason: item.name });

    const netChange = reward - item.price;
    const resultText =
      netChange >= 0
        ? `¡Ganaste **${reward.toLocaleString('es-ES')}** monedas! Ganancia neta: +${netChange.toLocaleString('es-ES')}.`
        : `Solo salieron **${reward.toLocaleString('es-ES')}** monedas. Pérdida neta: ${netChange.toLocaleString('es-ES')}.`;

    await interaction.editReply({
      content: `🎁 Abriste la caja misteriosa...\n${resultText}\nBalance actual: **${finalBalance.toLocaleString('es-ES')}**.`,
    });
    await announceUnlockedAchievements(interaction, userId, [firstPurchaseAchievement]);
    return;
  }

  // --- Ítems normales: se guardan en el inventario ---
  await incrementInventoryItem(guildId, userId, item.id, 1);

  // Si tiene un rol asociado, se lo damos automáticamente
  if (item.roleId) {
    try {
      member = member || (await interaction.guild.members.fetch(userId));
      await member.roles.add(item.roleId);
    } catch (error) {
      console.error('⚠️ No se pudo asignar el rol del ítem comprado:', error);
    }
  }

  // Si es de entrega manual, avisamos al staff en el canal de logs de economía
  if (item.fulfillment === 'manual') {
    const logChannel = await getGuildLogChannel(interaction.client, interaction.guildId, 'economy');
    if (logChannel) {
      await logChannel.send({ embeds: [createShopPurchaseLogEmbed({ user: interaction.user, item })] });
    }
  }

  let confirmText = `✅ Compraste **${item.name}** por ${item.price.toLocaleString('es-ES')} monedas. Balance restante: **${balanceAfterCharge.toLocaleString('es-ES')}**.`;
  if (item.fulfillment === 'manual') {
    confirmText += `\n📩 El staff fue notificado para completarte la entrega.`;
  }

  await interaction.editReply({ content: confirmText });
  await announceUnlockedAchievements(interaction, userId, [firstPurchaseAchievement]);
}
