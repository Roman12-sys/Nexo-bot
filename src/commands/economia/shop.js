import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { getGuildShopItems } from '../../utils/shopStore.js';
import { EMERALD_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { registerButtonPrefix } from '../../components/buttons.js';
import { registerSelectPrefix } from '../../components/selects.js';
import { runBuy } from './buy.js';

// Antes armaba UN embed con TODAS las categorías juntas — un catálogo grande (varios
// ítems propios por servidor) podía superar el límite de caracteres de un embed sin
// ningún aviso. Ahora pagina por categoría, una por página, mismo patrón de botones que
// /ranking y /leaderboard.
async function buildShopEmbed(guildId, page) {
  const items = await getGuildShopItems(guildId);

  const categories = {};
  for (const item of items) {
    if (!categories[item.category]) categories[item.category] = [];
    categories[item.category].push(item);
  }
  const categoryNames = Object.keys(categories);

  const totalPages = Math.max(1, categoryNames.length);
  const clampedPage = Math.min(Math.max(0, page), totalPages - 1);

  const embed = new EmbedBuilder()
    .setColor(EMERALD_COLOR)
    .setTitle('🛒 Tienda')
    .setDescription('Elegí un ítem del menú de abajo para comprarlo — o usá `/buy` directo si ya sabés cuál querés.')
    .setFooter({ text: categoryNames.length > 0 ? `${BRAND_NAME} • Página ${clampedPage + 1}/${totalPages}` : BRAND_NAME })
    .setTimestamp();

  if (categoryNames.length === 0) {
    embed.addFields({ name: 'Sin ítems', value: 'Todavía no hay nada en la tienda de este servidor.' });
  } else {
    const category = categoryNames[clampedPage];
    const lines = categories[category].map((item) => `**${item.name}** — ${item.price.toLocaleString('es-ES')} monedas\n${item.description}`);
    let value = lines.join('\n\n');

    // El comentario de arriba decía "ahora pagina por categoría" como si eso ya
    // resolviera el límite de 1024 — no del todo: una categoría CON MUCHOS ítems
    // (ej. un admin agregando 15 cosas a la misma categoría con /shop-admin) todavía
    // puede superarlo dentro de su propia página. Antes se cortaba en silencio.
    if (value.length > 1024) {
      let shown = 0;
      let acc = '';
      // Auditoría UX/UI (2026-09-18): 950 dejaba apenas ~70 caracteres de margen para
      // el sufijo "(+N ítem(s) más...)" de abajo (~90 caracteres) — con la cantidad
      // justa de ítems, `acc` + sufijo terminaba pasándose de los 1024 reales y
      // Discord rechazaba el embed entero. Encontrado con un test real (30 ítems en
      // una categoría), no en producción. 900 deja margen de sobra para el sufijo más
      // largo posible.
      for (const line of lines) {
        if (acc.length + line.length + 2 > 900) break;
        acc += (acc ? '\n\n' : '') + line;
        shown += 1;
      }
      value = `${acc}\n\n*(+${lines.length - shown} ítem(s) más — no entran en esta página, usá /shop-admin listar para verlos todos)*`;
    }

    embed.addFields({ name: `📦 ${category}`, value });
  }

  // categoryItems (no solo el texto renderizado) para que el caller pueda armar el
  // StringSelectMenu de compra con los IDs reales de esta página — auditoría UX/UI
  // (2026-09-18), hallazgo Importante: /shop (mirar) y /buy (comprar) eran dos
  // comandos separados, exigía copiar el nombre del ítem entre uno y otro.
  const categoryItems = categoryNames.length > 0 ? categories[categoryNames[clampedPage]] : [];
  return { embed, clampedPage, totalPages, categoryItems };
}

function buildShopSelectRow(categoryItems) {
  // StringSelectMenu tolera un máximo real de 25 opciones — una categoría con más
  // ítems que eso (posible con /shop-admin sin límite propio) corta acá, mismo
  // criterio de "no reventar en silencio" que ya usa el corte de texto de arriba.
  const options = categoryItems.slice(0, 25).map((item) => ({
    label: item.name.slice(0, 100),
    description: `${item.price.toLocaleString('es-ES')} monedas`.slice(0, 100),
    value: item.id,
  }));
  const select = new StringSelectMenuBuilder()
    .setCustomId('shop_buy_select')
    .setPlaceholder('Comprá un ítem de esta página...')
    .addOptions(options);
  return new ActionRowBuilder().addComponents(select);
}

function buildShopRow(clampedPage, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`shop_page_${clampedPage - 1}`)
      .setLabel('◀️ Categoría anterior')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clampedPage <= 0),
    new ButtonBuilder()
      .setCustomId(`shop_page_${clampedPage + 1}`)
      .setLabel('Siguiente categoría ▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clampedPage >= totalPages - 1),
  );
}

export const data = new SlashCommandBuilder()
  .setName('shop')
  .setDescription('Muestra los ítems disponibles en la tienda.')
  .setDMPermission(false);

function buildShopComponents(clampedPage, totalPages, categoryItems) {
  const rows = [];
  if (totalPages > 1) rows.push(buildShopRow(clampedPage, totalPages));
  if (categoryItems.length > 0) rows.push(buildShopSelectRow(categoryItems));
  return rows;
}

export async function execute(interaction) {
  await interaction.deferReply();
  const { embed, clampedPage, totalPages, categoryItems } = await buildShopEmbed(interaction.guildId, 0);
  await interaction.editReply({ embeds: [embed], components: buildShopComponents(clampedPage, totalPages, categoryItems) });
}

registerButtonPrefix('shop_page_', async (interaction) => {
  const page = parseInt(interaction.customId.slice('shop_page_'.length), 10);
  const { embed, clampedPage, totalPages, categoryItems } = await buildShopEmbed(interaction.guildId, page);
  await interaction.update({ embeds: [embed], components: buildShopComponents(clampedPage, totalPages, categoryItems) });
});

// El mensaje de /shop es público y compartido — cualquiera en el canal puede tocar este
// select, no solo quien corrió el comando. Nunca usar i.update() acá: eso pisaría el
// catálogo compartido con el resultado de la compra de UNA persona. runBuy() responde
// con su propio reply/deferReply/editReply sobre ESTA interacción (un mensaje aparte),
// dejando el panel de /shop intacto para todos los demás — mismo `runBuy` que ya usa
// /buy directo, nunca una segunda copia de la lógica de cobro/entrega.
registerSelectPrefix('shop_buy_select', async (interaction) => {
  const itemId = interaction.values[0];
  await runBuy(interaction, itemId);
});
