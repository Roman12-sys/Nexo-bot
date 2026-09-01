// QUÉ CAMBIÓ: MAX_MYSTERY bajó de 600 a 400 (constante, sin tocar el flujo de compra).
// MOTIVO: auditoría 2026-08-29 (Diagnóstico Nexo, Parte 12) — con MAX_MYSTERY=600 el
// valor esperado de la caja misteriosa era (50+600)/2=325, por encima de su precio de
// 250. Comprarla en loop imprimía ~+75 monedas por unidad en expectativa, sin cooldown
// ni tope de compras. Con MAX_MYSTERY=400, EV=(50+400)/2=225 < 250: vuelve a ser un
// sink neto en expectativa, como el resto de la tienda.
// VERIFICACIÓN: abrir varias cajas y confirmar que el promedio de recompensas tiende a
// ~225 (nunca sobre 400), y que el balance total del servidor no sube solo por abrir
// cajas en loop.
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getGuildShopItems, getShopItem } from '../../utils/shopStore.js';
import { getUserEconomy, deductBalanceIfSufficient, incrementInventoryItem, addBalance, recordTransaction, extendRobShield } from '../../utils/economyStore.js';
import { extendXpBoost } from '../../utils/xpStore.js';
import { createShopPurchaseLogEmbed } from '../../utils/logEmbeds.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';
import { eventBus } from '../../utils/eventBus.js'; // Event Engine — auditoría 2026-08-29, Parte 7
import { withLock } from '../../utils/asyncLock.js';

const MIN_MYSTERY = 50;
const MAX_MYSTERY = 400;
const XP_BOOST_DURATION_MS = 24 * 60 * 60 * 1000;
const ROB_SHIELD_DURATION_MS = 2 * 60 * 60 * 1000;

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

  // Chequeo de saldo ANTES de deferir: así el error de "no te alcanza" puede
  // responderse ephemeral (una vez deferido en público, ya no se puede cambiar).
  const economyBefore = await getUserEconomy(guildId, userId);
  if (economyBefore.balance < item.price) {
    const faltante = item.price - economyBefore.balance;
    await interaction.reply({ content: `❌ No tenés suficientes monedas. Te faltan **${faltante.toLocaleString('es-ES')}**.`, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply();

  // Todo el flujo de compra (chequeo de "¿ya lo tengo?" para ítems de rol + cobro +
  // entrega) va bajo lock por usuario+server: sin esto, un doble-click en "comprar"
  // podía pasar el chequeo de "ya lo tengo" dos veces antes de que ninguna compra
  // terminara, cobrando dos veces por un ítem de rol de uso único.
  await withLock(`buy:${guildId}:${userId}`, async () => {
    // Si el ítem da un rol y ya lo tenés, cortamos ANTES de cobrar — comprarlo de
    // nuevo sería un cargo por nada (el roles.add de más abajo es un no-op si ya lo tenés).
    let member = null;
    if (item.roleId) {
      // QUÉ CAMBIÓ: chequeo de que el rol configurado TODAVÍA exista en el servidor,
      // antes de cobrar nada. roles.cache está siempre completo y actualizado (a
      // diferencia de members.cache, no hace falta fetch) — mismo chequeo que ya usaba
      // /punish para su propio rol configurado. Sin esto, un ítem cuyo rol se borró de
      // Discord (pero sigue en el catálogo) cobraba igual y fallaba en silencio al
      // intentar asignarlo más abajo, con el usuario pagando sin recibir nada.
      // MOTIVO: auditoría Fase 2B, sección 11.
      if (!interaction.guild.roles.cache.has(item.roleId)) {
        await interaction.editReply({
          content: `⚠️ El rol de **${item.name}** ya no existe en este servidor. Avisale al staff para que lo reconfigure con \`/shop-admin\` — no se te cobró nada.`,
        });
        return;
      }

      member = await interaction.guild.members.fetch(userId).catch(() => null);
      if (member?.roles.cache.has(item.roleId)) {
        await interaction.editReply({ content: `⚠️ Ya tenés **${item.name}**.` });
        return;
      }
    }

    // deductBalanceIfSufficient cobra en una sola sentencia atómica: si no alcanza,
    // rechaza sin descontar nada (cubre el caso, ya raro gracias al lock, de que el
    // saldo haya bajado entre el chequeo de arriba y este punto).
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
    // QUÉ CAMBIÓ: antes esta línea llamaba unlockAchievement() una sola vez acá arriba
    // (la promesa se guardaba y se anunciaba recién en el branch que terminara
    // ejecutándose). Migrado al Event Engine: como los 4 branches de abajo son
    // mutuamente excluyentes (siempre se ejecuta exactamente uno), mover el chequeo al
    // punto de salida en vez de al punto de entrada no cambia nada observable — sigue
    // siendo exactamente un chequeo de logro por compra.
    const checkFirstPurchaseAchievement = () => eventBus.emit('ACHIEVEMENT_CHECK', { guildId, userId, achievementId: 'primera_compra', interaction });

    // --- Caso especial: caja misteriosa (solo existe en el catálogo por defecto) ---
    // No se guarda en el inventario, se resuelve al instante con una recompensa al azar
    if (item.type === 'mystery_box') {
      const reward = Math.floor(Math.random() * (MAX_MYSTERY - MIN_MYSTERY + 1)) + MIN_MYSTERY;
      const netChange = reward - item.price;
      // QUÉ CAMBIÓ (Fase A, segunda auditoría 2026-08-30): se agrega `netGain` — mismo
      // motivo que gamble_win en casinoHelpers.js. Pagar 250 y sacar 400 es una ganancia
      // neta de 150, no de 400; sin esto, misiones/analítica contaban el bruto.
      const finalBalance = await addBalance(guildId, userId, reward, { type: 'mystery_box', reason: item.name, netGain: netChange });

      const resultText =
        netChange >= 0
          ? `¡Ganaste **${reward.toLocaleString('es-ES')}** monedas! Ganancia neta: +${netChange.toLocaleString('es-ES')}.`
          : `Solo salieron **${reward.toLocaleString('es-ES')}** monedas. Pérdida neta: ${netChange.toLocaleString('es-ES')}.`;

      await interaction.editReply({
        content: `🎁 Abriste la caja misteriosa...\n${resultText}\nBalance actual: **${finalBalance.toLocaleString('es-ES')}**.`,
      });
      await checkFirstPurchaseAchievement();
      return;
    }

    // --- Caso especial: impulso de XP (x2 por 24hs, se extiende si ya tenía uno activo) ---
    if (item.type === 'xp_boost') {
      const until = await extendXpBoost(guildId, userId, XP_BOOST_DURATION_MS);
      await interaction.editReply({
        content: `⚡ ¡Impulso de XP activado! Ganás el doble de XP hasta <t:${Math.floor(until / 1000)}:f>.\nBalance restante: **${balanceAfterCharge.toLocaleString('es-ES')}**.`,
      });
      await checkFirstPurchaseAchievement();
      return;
    }

    // --- Caso especial: escudo anti-robo (2hs, se extiende si ya tenía uno activo) ---
    if (item.type === 'rob_shield') {
      const until = await extendRobShield(guildId, userId, ROB_SHIELD_DURATION_MS);
      await interaction.editReply({
        content: `🛡️ ¡Escudo activado! Nadie puede robarte hasta <t:${Math.floor(until / 1000)}:f>.\nBalance restante: **${balanceAfterCharge.toLocaleString('es-ES')}**.`,
      });
      await checkFirstPurchaseAchievement();
      return;
    }

    // --- Ítems normales: se guardan en el inventario (esto incluye comida de mascota,
    // type:'pet_food' — /pet alimentar la busca en el inventario por tipo, no hace
    // falta un caso especial acá) ---
    await incrementInventoryItem(guildId, userId, item.id, 1);

    // Si tiene un rol asociado, se lo damos automáticamente
    if (item.roleId) {
      try {
        member = member || (await interaction.guild.members.fetch(userId));
        await member.roles.add(item.roleId);
      } catch (error) {
        // QUÉ CAMBIÓ: antes este catch solo logueaba y seguía — la compra terminaba
        // confirmándose como éxito (cobrada + en el inventario) aunque el rol nunca se
        // hubiera entregado (ej. el rol se borró justo entre el chequeo de arriba y
        // este punto, o el bot perdió el permiso Gestionar roles). Ahora revierte todo
        // lo que ya se aplicó (inventario + cobro) y le avisa al usuario, en vez de
        // confirmarle una compra que no recibió. No es un sistema financiero nuevo: usa
        // los mismos primitivos atómicos que el resto de la economía
        // (incrementInventoryItem con delta negativo, addBalance).
        // MOTIVO: auditoría Fase 2B, sección 11 — "no debe existir una compra que el
        // usuario pague y el bot confirme como exitosa sin entregar el beneficio".
        console.error('⚠️ No se pudo asignar el rol del ítem comprado — revirtiendo la compra:', error);

        await incrementInventoryItem(guildId, userId, item.id, -1).catch((e) =>
          console.error('⚠️ No se pudo revertir el inventario tras el fallo de rol:', e),
        );
        const refundedBalance = await addBalance(guildId, userId, item.price, {
          type: 'purchase_refund',
          reason: `Reembolso: no se pudo entregar ${item.name}`,
        }).catch((e) => {
          console.error('⚠️ No se pudo reembolsar el cobro tras el fallo de rol:', e);
          return null;
        });

        const balanceLine = refundedBalance !== null ? ` Balance actual: **${refundedBalance.toLocaleString('es-ES')}**.` : '';
        await interaction.editReply({
          content: `❌ No se pudo entregar **${item.name}** (el rol ya no existe o no lo pude asignar). Se te reembolsaron ${item.price.toLocaleString('es-ES')} monedas.${balanceLine}`,
        });
        return;
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
    await checkFirstPurchaseAchievement();
  });
}
