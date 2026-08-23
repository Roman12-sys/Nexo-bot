import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import SHOP_ITEMS from '../../utils/shopItems.js';
import { getUserEconomy, addBalance, setBalance, getUserTransactions } from '../../utils/economyStore.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { createEconomyAdminLogEmbed } from '../../utils/logEmbeds.js';
import { isStaff } from '../../utils/permissions.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';

const TYPE_LABELS = {
  daily: '🎁 Diaria',
  work: '💼 Trabajo',
  trivia: '🧠 Trivia',
  guess: '🔢 Adivinar número',
  purchase: '🛍️ Compra',
  mystery_box: '🎁 Caja misteriosa',
  transfer_in: '📥 Transferencia recibida',
  transfer_out: '📤 Transferencia enviada',
  admin_add: '➕ Staff agregó',
  admin_remove: '➖ Staff quitó',
  admin_set: '🛠️ Staff estableció',
};

async function logStaffAction(interaction, { type, targetUser, amount, balanceBefore, balanceAfter, reason }) {
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

async function handleHistorial(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const targetUser = interaction.options.getUser('usuario');
  const cantidad = interaction.options.getInteger('cantidad') || 10;
  const movimientos = await getUserTransactions(interaction.guild.id, targetUser.id, cantidad);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`📜 Historial de ${targetUser.tag}`)
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();

  if (movimientos.length === 0) {
    embed.setDescription('No hay movimientos registrados para este usuario.');
  } else {
    embed.setDescription(
      movimientos
        .map((m) => {
          const label = TYPE_LABELS[m.type] || m.type;
          const signo = m.amount >= 0 ? '+' : '';
          const actor = m.actorId && m.actorId !== targetUser.id ? ` · por <@${m.actorId}>` : '';
          const motivo = m.reason ? ` — ${m.reason}` : '';
          return `**${label}** ${signo}${m.amount.toLocaleString('es-ES')} (balance: ${m.balanceAfter.toLocaleString('es-ES')})${actor}${motivo}\n<t:${Math.floor(m.timestamp / 1000)}:f>`;
        })
        .join('\n\n')
        .slice(0, 4096),
    );
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handlePerfil(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const targetUser = interaction.options.getUser('usuario');
  const economy = await getUserEconomy(interaction.guild.id, targetUser.id);
  const now = Date.now();

  const dailyReady = now - economy.lastDaily >= 24 * 60 * 60 * 1000;
  const workReady = now - economy.lastWork >= 60 * 60 * 1000;

  const owned = Object.entries(economy.inventory || {}).filter(([, qty]) => qty > 0);
  const inventoryText =
    owned.length === 0
      ? 'Sin ítems.'
      : owned
          .map(([itemId, qty]) => {
            const item = SHOP_ITEMS.find((i) => i.id === itemId);
            return `${item ? item.name : itemId} x${qty}`;
          })
          .join('\n');

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
      .addIntegerOption((o) => o.setName('cantidad').setDescription('Cuántos movimientos mostrar (por defecto 10)').setRequired(false).setMinValue(1).setMaxValue(25)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('perfil')
      .setDescription('Muestra balance, cooldowns e inventario de un usuario en un solo lugar.')
      .addUserOption((o) => o.setName('usuario').setDescription('Usuario').setRequired(true)),
  )
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
  } catch (error) {
    console.error(`❌ Error al ejecutar /economia-staff ${sub}:`, error);
    const errorMsg = { content: '❌ Ocurrió un error al ejecutar el comando.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMsg);
    } else {
      await interaction.reply(errorMsg);
    }
  }
}
