import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getGuildShopItems } from '../../utils/shopStore.js';
import { getUserEconomy } from '../../utils/economyStore.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';

// Extraída para que /perfil pueda mostrar el mismo inventario sin duplicar esta lógica.
export async function buildInventoryEmbed(guildId, targetUser) {
  const [economy, shopItems] = await Promise.all([
    getUserEconomy(guildId, targetUser.id),
    getGuildShopItems(guildId),
  ]);

  const owned = Object.entries(economy.inventory || {}).filter(([, qty]) => qty > 0);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`🎒 Inventario de ${targetUser.tag}`)
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();

  if (owned.length === 0) {
    embed.setDescription('No tiene ningún ítem todavía.');
  } else {
    embed.setDescription(
      owned
        .map(([itemId, qty]) => {
          const item = shopItems.find((i) => i.id === itemId);
          const name = item ? item.name : itemId;
          return `${name} x${qty}`;
        })
        .join('\n'),
    );
  }

  return embed;
}

export const data = new SlashCommandBuilder()
  .setName('inventory')
  .setDescription('Muestra tu inventario (o el de otro usuario).')
  .addUserOption((o) => o.setName('usuario').setDescription('Usuario a consultar (opcional)').setRequired(false))
  .setDMPermission(false);

export async function execute(interaction) {
  await interaction.deferReply();
  const targetUser = interaction.options.getUser('usuario') || interaction.user;
  const embed = await buildInventoryEmbed(interaction.guild.id, targetUser);
  await interaction.editReply({ embeds: [embed] });
}
