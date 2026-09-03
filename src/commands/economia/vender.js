// Antes se podía comprar pero nunca devolver — sin esto, un ítem que ya no querés queda
// muerto en el inventario para siempre. Los ítems con rol NO se pueden vender: el rol ya
// se entregó y sigue siendo tuyo, "devolverlo" sería cobrar dos veces por el mismo rol
// (una al comprarlo, otra si lo volvieras a comprar después de venderlo).
import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getGuildShopItems, getShopItem } from '../../utils/shopStore.js';
import { getUserEconomy, incrementInventoryItem, addBalance } from '../../utils/economyStore.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { withLock } from '../../utils/asyncLock.js';

export const SELL_RATIO = 0.5;

export const data = new SlashCommandBuilder()
  .setName('vender')
  .setDescription('Vendé un ítem de tu inventario de vuelta a la tienda por la mitad de su precio.')
  .addStringOption((o) => o.setName('item').setDescription('Qué ítem vender (escribí para buscar)').setRequired(true).setAutocomplete(true))
  .setDMPermission(false);

// Solo sugiere ítems que el usuario REALMENTE tiene en el inventario (con cantidad > 0),
// a diferencia de /buy que sugiere todo el catálogo — acá no tendría sentido ofrecer
// vender algo que no tenés.
export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const [items, economy] = await Promise.all([
    getGuildShopItems(interaction.guildId).catch(() => []),
    getUserEconomy(interaction.guildId, interaction.user.id).catch(() => ({ inventory: {} })),
  ]);

  const matches = items
    .filter((item) => !item.roleId && (economy.inventory[item.id] || 0) > 0 && item.name.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((item) => ({
      name: `${item.name} (x${economy.inventory[item.id]}) — ${Math.floor(item.price * SELL_RATIO).toLocaleString('es-ES')} monedas`.slice(0, 100),
      value: item.id,
    }));

  await interaction.respond(matches);
}

export async function execute(interaction) {
  const itemId = interaction.options.getString('item');
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  const item = await getShopItem(guildId, itemId);
  if (!item) {
    await interaction.reply({ content: '❌ Ese ítem no existe. Elegilo de las sugerencias mientras escribís.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (item.roleId) {
    await interaction.reply({ content: '❌ Los ítems que dan un rol no se pueden vender — el rol ya es tuyo.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await withLock(`vender:${guildId}:${userId}`, async () => {
    // Se relee el inventario recién acá, adentro del lock — mismo motivo que /buy:
    // evita que dos /vender casi simultáneos del mismo ítem vendan más unidades de las
    // que realmente había.
    const economy = await getUserEconomy(guildId, userId);
    const owned = economy.inventory[itemId] || 0;
    if (owned < 1) {
      await interaction.editReply({ content: `❌ No tenés **${item.name}** en tu inventario.` });
      return;
    }

    const sellPrice = Math.floor(item.price * SELL_RATIO);
    // El pre-check de arriba (owned < 1) lee bajo el mismo lock, pero ese lock es solo
    // por usuario+comando ("vender:...") — no cubre otra feature con OTRO lock
    // consumiendo el mismo ítem al mismo tiempo (ej. /buy revirtiendo una compra
    // fallida, "buy:...", ver schema.sql increment_inventory_item). Ahí es donde puede
    // llegar insufficient_inventory (Fase 1.1): respuesta de negocio clara, no el catch
    // genérico de interactionCreate.js.
    try {
      await incrementInventoryItem(guildId, userId, itemId, -1);
    } catch (error) {
      if (error.code === 'insufficient_inventory') {
        await interaction.editReply({ content: `❌ Ya no tenés **${item.name}** en tu inventario — puede que se haya usado justo ahora. Revisá \`/inventory\` e intentá de nuevo.` });
        return;
      }
      throw error;
    }
    const newBalance = await addBalance(guildId, userId, sellPrice, { type: 'sell', reason: item.name });

    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle('💱 Ítem vendido')
      .setDescription(`Vendiste **${item.name}** por **${sellPrice.toLocaleString('es-ES')}** monedas (50% del precio).\nBalance: **${newBalance.toLocaleString('es-ES')}**.`)
      .setFooter({ text: BRAND_NAME })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  });
}
