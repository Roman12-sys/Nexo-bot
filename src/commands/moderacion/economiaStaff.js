import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { getGuildShopItems } from '../../utils/shopStore.js';
import { getUserEconomy, addBalance, setBalance, getUserTransactions, getGuildPurchasesByReason, markPurchaseDelivered } from '../../utils/economyStore.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { createEconomyAdminLogEmbed } from '../../utils/logEmbeds.js';
import { isStaff } from '../../utils/permissions.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';
import { buildCsvAttachment } from '../../utils/csvExport.js';
import { describeError } from '../../utils/errorMessages.js';
import { registerButtonPrefix } from '../../components/buttons.js';
import { registerSelectPrefix } from '../../components/selects.js';

const TYPE_LABELS = {
  daily: '🎁 Diaria',
  work: '💼 Trabajo',
  trivia: '🧠 Trivia',
  guess: '🔢 Adivinar número',
  purchase: '🛍️ Compra',
  purchase_refund: '↩️ Reembolso de compra',
  mystery_box: '🎁 Caja misteriosa',
  transfer_in: '📥 Transferencia recibida',
  transfer_out: '📤 Transferencia enviada',
  admin_add: '➕ Staff agregó',
  admin_remove: '➖ Staff quitó',
  admin_set: '🛠️ Staff estableció',
  gamble_bet: '🎲 Apuesta (coinflip)',
  gamble_win: '🎉 Premio (coinflip)',
  bank_deposit: '🏦 Depósito al banco',
  bank_withdraw: '🏦 Retiro del banco',
  bank_interest: '💰 Interés del banco',
  rob_win: '🥷 Robo exitoso',
  rob_loss: '💸 Te robaron',
  rob_fine: '🚨 Multa por robo',
  crime_win: '🕵️ Golpe exitoso',
  crime_fine: '🚨 Multa por crimen',
  weekly: '🎁 Semanal',
  sell: '💱 Venta de ítem',
};

// Se llama SIEMPRE después de que el ajuste de balance ya se aplicó y ya se le confirmó
// al staff — atrapa sus propios errores para que un log fallido nunca aparente que el
// ajuste en sí falló, lo que llevaría a reintentar uno ya aplicado.
async function logStaffAction(interaction, { type, targetUser, amount, balanceBefore, balanceAfter, reason }) {
  try {
    const logChannel = await getGuildLogChannel(interaction.client, interaction.guildId, 'economy');
    if (!logChannel) return;

    await logChannel.send({
      embeds: [
        createEconomyAdminLogEmbed({
          type,
          targetUser,
          executor: interaction.user,
          amount,
          balanceBefore,
          balanceAfter,
          reason,
        }),
      ],
    });
  } catch (error) {
    console.error('⚠️ No se pudo registrar un ajuste de economía staff en el canal de logs:', error);
  }
}

async function handleBalance(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const targetUser = interaction.options.getUser('usuario');
  const economy = await getUserEconomy(interaction.guild.id, targetUser.id);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`💰 Balance de ${targetUser.tag}`)
    .setDescription(`**${economy.balance.toLocaleString('es-ES')}** monedas`)
    .setThumbnail(targetUser.displayAvatarURL())
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleAdjust(interaction, direction) {
  await interaction.deferReply();
  const targetUser = interaction.options.getUser('usuario');
  const cantidad = interaction.options.getInteger('cantidad');
  const motivo = interaction.options.getString('motivo') || 'Sin motivo especificado';

  const before = (await getUserEconomy(interaction.guild.id, targetUser.id)).balance;
  const type = direction === 1 ? 'admin_add' : 'admin_remove';
  const signedAmount = direction * cantidad;

  const after = await addBalance(interaction.guild.id, targetUser.id, signedAmount, {
    type,
    actorId: interaction.user.id,
    reason: motivo,
  });

  const verbo = direction === 1 ? 'agregaron' : 'quitaron';
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(direction === 1 ? '➕ Monedas agregadas' : '➖ Monedas quitadas')
    .setDescription(`Se le ${verbo} **${cantidad.toLocaleString('es-ES')}** monedas a ${targetUser}.\nBalance: ${before.toLocaleString('es-ES')} → **${after.toLocaleString('es-ES')}**.`)
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
  await logStaffAction(interaction, { type, targetUser, amount: signedAmount, balanceBefore: before, balanceAfter: after, reason: motivo });
}

async function handleSet(interaction) {
  await interaction.deferReply();
  const targetUser = interaction.options.getUser('usuario');
  const cantidad = interaction.options.getInteger('cantidad');
  const motivo = interaction.options.getString('motivo') || 'Sin motivo especificado';

  const before = (await getUserEconomy(interaction.guild.id, targetUser.id)).balance;
  const after = await setBalance(interaction.guild.id, targetUser.id, cantidad, {
    type: 'admin_set',
    actorId: interaction.user.id,
    reason: motivo,
  });

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🛠️ Balance establecido')
    .setDescription(`El balance de ${targetUser} pasó de **${before.toLocaleString('es-ES')}** a **${after.toLocaleString('es-ES')}**.`)
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
  await logStaffAction(interaction, { type: 'admin_set', targetUser, amount: after - before, balanceBefore: before, balanceAfter: after, reason: motivo });
}

const HISTORIAL_PAGE_SIZE = 5;

// Cada movimiento es su propio campo (mismo criterio que /warns) en vez de una sola
// descripción con saltos de línea — más fácil de escanear con historiales largos.
function buildHistorialEmbed(targetUser, movimientos, page) {
  const totalPages = Math.max(1, Math.ceil(movimientos.length / HISTORIAL_PAGE_SIZE));
  const clampedPage = Math.min(Math.max(0, page), totalPages - 1);
  const slice = movimientos.slice(clampedPage * HISTORIAL_PAGE_SIZE, clampedPage * HISTORIAL_PAGE_SIZE + HISTORIAL_PAGE_SIZE);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`📜 Historial de ${targetUser.tag}`)
    .setFooter({ text: `${BRAND_NAME} • Página ${clampedPage + 1}/${totalPages}` })
    .setTimestamp();

  if (movimientos.length === 0) {
    embed.setDescription('No hay movimientos registrados para este usuario.');
  } else {
    embed.addFields(
      slice.map((m) => {
        const label = TYPE_LABELS[m.type] || m.type;
        const signo = m.amount >= 0 ? '+' : '';
        const actor = m.actorId && m.actorId !== targetUser.id ? ` · por <@${m.actorId}>` : '';
        const motivo = m.reason ? ` — ${m.reason}` : '';
        return {
          name: `${label} · <t:${Math.floor(m.timestamp / 1000)}:f>`,
          value: `${signo}${m.amount.toLocaleString('es-ES')} (balance: ${m.balanceAfter.toLocaleString('es-ES')})${actor}${motivo}`,
        };
      }),
    );
  }

  return { embed, clampedPage, totalPages };
}

function buildHistorialRow(targetUserId, clampedPage, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ecostaff_hist_page_${clampedPage - 1}_${targetUserId}`)
      .setLabel('◀️ Anterior')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clampedPage <= 0),
    new ButtonBuilder()
      .setCustomId(`ecostaff_hist_page_${clampedPage + 1}_${targetUserId}`)
      .setLabel('Siguiente ▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clampedPage >= totalPages - 1),
  );
}

async function handleHistorial(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const targetUser = interaction.options.getUser('usuario');
  const exportar = interaction.options.getBoolean('exportar') || false;

  // Exportando no tiene sentido cortar en 10 — se trae bastante más (tope razonable,
  // no "todo" sin límite para no pedirle a Supabase una consulta sin fin).
  const cantidad = exportar ? 1000 : interaction.options.getInteger('cantidad') || 25;
  const movimientos = await getUserTransactions(interaction.guild.id, targetUser.id, cantidad);

  if (exportar) {
    if (movimientos.length === 0) {
      await interaction.editReply({ content: 'No hay movimientos registrados para este usuario.' });
      return;
    }
    const attachment = buildCsvAttachment(
      `historial-${targetUser.id}.csv`,
      [
        { key: 'fecha', header: 'Fecha' },
        { key: 'tipo', header: 'Tipo' },
        { key: 'monto', header: 'Monto' },
        { key: 'balance', header: 'Balance después' },
        { key: 'actor', header: 'Ejecutado por' },
        { key: 'motivo', header: 'Motivo' },
      ],
      movimientos.map((m) => ({
        fecha: new Date(m.timestamp).toISOString(),
        tipo: TYPE_LABELS[m.type] || m.type,
        monto: m.amount,
        balance: m.balanceAfter,
        actor: m.actorId || '',
        motivo: m.reason || '',
      })),
    );
    await interaction.editReply({ content: `📄 Historial de ${targetUser.tag} (${movimientos.length} movimiento(s)).`, files: [attachment] });
    return;
  }

  const { embed, clampedPage, totalPages } = buildHistorialEmbed(targetUser, movimientos, 0);
  const components = movimientos.length > HISTORIAL_PAGE_SIZE ? [buildHistorialRow(targetUser.id, clampedPage, totalPages)] : [];
  await interaction.editReply({ embeds: [embed], components });
}

registerButtonPrefix('ecostaff_hist_page_', async (i) => {
  if (!(await isStaff(i))) return i.reply({ content: '❌ No tenés permisos.', flags: MessageFlags.Ephemeral });

  // deferUpdate() apenas se confirma el permiso — antes el único ack (i.update) llegaba
  // recién después de 2 awaits (users.fetch + getUserTransactions), lo que arriesgaba
  // "Unknown interaction" si sumaban más de 3s. Ver sección 3 de la auditoría Fase 2B.
  await i.deferUpdate();

  const [pageRaw, targetUserId] = i.customId.slice('ecostaff_hist_page_'.length).split('_');
  const targetUser = await i.client.users.fetch(targetUserId).catch(() => null);
  if (!targetUser) return i.editReply({ content: '❌ No se pudo encontrar a ese usuario.', embeds: [], components: [] });

  const movimientos = await getUserTransactions(i.guildId, targetUserId, 25);
  const { embed, clampedPage, totalPages } = buildHistorialEmbed(targetUser, movimientos, parseInt(pageRaw, 10));
  await i.editReply({ embeds: [embed], components: [buildHistorialRow(targetUserId, clampedPage, totalPages)] });
});

async function handlePerfil(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const targetUser = interaction.options.getUser('usuario');
  const [economy, shopItems] = await Promise.all([
    getUserEconomy(interaction.guild.id, targetUser.id),
    getGuildShopItems(interaction.guildId),
  ]);
  const now = Date.now();

  const dailyReady = now - economy.lastDaily >= 24 * 60 * 60 * 1000;
  const workReady = now - economy.lastWork >= 60 * 60 * 1000;

  const owned = Object.entries(economy.inventory || {}).filter(([, qty]) => qty > 0);
  const ownedLines = owned.map(([itemId, qty]) => {
    const item = shopItems.find((i) => i.id === itemId);
    return `${item ? item.name : itemId} x${qty}`;
  });
  let inventoryText = owned.length === 0 ? 'Sin ítems.' : ownedLines.join('\n');
  if (inventoryText.length > 1024) {
    inventoryText = `${ownedLines.join('\n').slice(0, 970)}\n*(hay más — usá /inventory para verlo completo)*`;
  }

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`🧾 Perfil económico de ${targetUser.tag}`)
    .setThumbnail(targetUser.displayAvatarURL())
    .addFields(
      { name: '💰 Balance', value: `${economy.balance.toLocaleString('es-ES')} monedas`, inline: true },
      { name: '🎁 /daily', value: dailyReady ? 'Disponible' : `<t:${Math.floor((economy.lastDaily + 86400000) / 1000)}:R>`, inline: true },
      { name: '💼 /work', value: workReady ? 'Disponible' : `<t:${Math.floor((economy.lastWork + 3600000) / 1000)}:R>`, inline: true },
      { name: '🎒 Inventario', value: inventoryText },
    )
    .setFooter({ text: `${BRAND_NAME} • Usá /economia-staff historial para ver movimientos` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// Antes, los ítems de entrega MANUAL (cambio de apodo, mención en anuncio) solo avisaban
// una vez en el canal de logs de economía — si se perdía de vista, nadie sabía qué
// faltaba cumplir. Esto centraliza las últimas compras de esos ítems en un solo lugar.
async function buildPendientesPayload(guildId) {
  const shopItems = await getGuildShopItems(guildId);
  const manualNames = shopItems.filter((item) => item.fulfillment === 'manual').map((item) => item.name);

  if (manualNames.length === 0) {
    return { content: 'Ningún ítem de la tienda de este servidor es de entrega manual.', embeds: [], components: [] };
  }

  const purchases = await getGuildPurchasesByReason(guildId, manualNames, 25, { onlyPending: true });

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('📬 Compras de entrega manual pendientes')
    .setFooter({ text: `${BRAND_NAME} • ${purchases.length} pendiente(s)` })
    .setTimestamp();

  embed.setDescription(
    purchases.length === 0
      ? '✅ No hay compras pendientes de entrega.'
      : purchases.map((p) => `<@${p.userId}> — **${p.reason}** · <t:${Math.floor(p.timestamp / 1000)}:R>`).join('\n'),
  );

  const components = [];
  if (purchases.length > 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId('ecostaff_pendiente_entregada')
      .setPlaceholder('✅ Marcar una compra como entregada')
      .addOptions(
        purchases.map((p) => ({
          label: `${p.reason} · ${new Date(p.timestamp).toLocaleDateString('es-ES')}`.slice(0, 100),
          description: `Para <@${p.userId}>`.replace(/<@|>/g, '').slice(0, 100),
          value: String(p.id),
        })),
      );
    components.push(new ActionRowBuilder().addComponents(select));
  }

  return { embeds: [embed], components };
}

async function handlePendientes(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await interaction.editReply(await buildPendientesPayload(interaction.guildId));
}

registerSelectPrefix('ecostaff_pendiente_entregada', async (i) => {
  if (!(await isStaff(i))) return i.reply({ content: '❌ No tenés permisos.', flags: MessageFlags.Ephemeral });

  // deferUpdate() apenas se confirma el permiso — antes el único ack (i.update) llegaba
  // recién después de markPurchaseDelivered + buildPendientesPayload (2 llamadas a
  // Supabase), lo que arriesgaba "Unknown interaction" si sumaban más de 3s. Ver
  // sección 3 de la auditoría Fase 2B.
  await i.deferUpdate();

  await markPurchaseDelivered(parseInt(i.values[0], 10));
  await i.editReply(await buildPendientesPayload(i.guildId));
});

export const data = new SlashCommandBuilder()
  .setName('economia-staff')
  .setDescription('Panel de staff para gestionar y supervisar la economía del servidor.')
  .addSubcommand((sub) =>
    sub
      .setName('balance')
      .setDescription('Ver el balance de un usuario.')
      .addUserOption((o) => o.setName('usuario').setDescription('Usuario a consultar').setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('agregar')
      .setDescription('Agrega monedas al balance de un usuario.')
      .addUserOption((o) => o.setName('usuario').setDescription('Usuario').setRequired(true))
      .addIntegerOption((o) => o.setName('cantidad').setDescription('Cuántas monedas agregar').setRequired(true).setMinValue(1))
      .addStringOption((o) => o.setName('motivo').setDescription('Motivo').setRequired(false).setMaxLength(512)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('quitar')
      .setDescription('Quita monedas del balance de un usuario.')
      .addUserOption((o) => o.setName('usuario').setDescription('Usuario').setRequired(true))
      .addIntegerOption((o) => o.setName('cantidad').setDescription('Cuántas monedas quitar').setRequired(true).setMinValue(1))
      .addStringOption((o) => o.setName('motivo').setDescription('Motivo').setRequired(false).setMaxLength(512)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('establecer')
      .setDescription('Fija el balance de un usuario a una cantidad exacta.')
      .addUserOption((o) => o.setName('usuario').setDescription('Usuario').setRequired(true))
      .addIntegerOption((o) => o.setName('cantidad').setDescription('Balance exacto a fijar').setRequired(true).setMinValue(0))
      .addStringOption((o) => o.setName('motivo').setDescription('Motivo').setRequired(false).setMaxLength(512)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('historial')
      .setDescription('Muestra los últimos movimientos de economía de un usuario.')
      .addUserOption((o) => o.setName('usuario').setDescription('Usuario').setRequired(true))
      .addIntegerOption((o) => o.setName('cantidad').setDescription('Cuántos movimientos mostrar (por defecto 10)').setRequired(false).setMinValue(1).setMaxValue(25))
      .addBooleanOption((o) => o.setName('exportar').setDescription('Adjuntar el historial completo (hasta 1000) como CSV en vez de mostrarlo').setRequired(false)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('perfil')
      .setDescription('Muestra balance, cooldowns e inventario de un usuario en un solo lugar.')
      .addUserOption((o) => o.setName('usuario').setDescription('Usuario').setRequired(true)),
  )
  .addSubcommand((sub) => sub.setName('pendientes').setDescription('Últimas compras de ítems de entrega manual (cambio de apodo, etc).'))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!(await isStaff(interaction))) {
    await interaction.reply({ content: '❌ No tenés permisos para usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  const sub = interaction.options.getSubcommand();

  try {
    if (sub === 'balance') return await handleBalance(interaction);
    if (sub === 'agregar') return await handleAdjust(interaction, 1);
    if (sub === 'quitar') return await handleAdjust(interaction, -1);
    if (sub === 'establecer') return await handleSet(interaction);
    if (sub === 'historial') return await handleHistorial(interaction);
    if (sub === 'perfil') return await handlePerfil(interaction);
    if (sub === 'pendientes') return await handlePendientes(interaction);
  } catch (error) {
    console.error(`❌ Error al ejecutar /economia-staff ${sub}:`, error);
    const errorMsg = { content: describeError(error, '❌ Ocurrió un error al ejecutar el comando.'), flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMsg);
    } else {
      await interaction.reply(errorMsg);
    }
  }
}
