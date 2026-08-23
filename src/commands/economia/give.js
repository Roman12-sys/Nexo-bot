import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getUserEconomy, transferBalance, recordTransaction } from '../../utils/economyStore.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { createGiveSuspiciousLogEmbed } from '../../utils/logEmbeds.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';
import { recordGive } from '../../utils/giveTracker.js';

export const data = new SlashCommandBuilder()
  .setName('give')
  .setDescription('Transferí monedas a otro usuario.')
  .addUserOption((o) => o.setName('usuario').setDescription('A quién le transferís').setRequired(true))
  .addIntegerOption((o) => o.setName('cantidad').setDescription('Cuántas monedas').setRequired(true).setMinValue(1))
  .setDMPermission(false);

export async function execute(interaction) {
  const targetUser = interaction.options.getUser('usuario');
  const cantidad = interaction.options.getInteger('cantidad');

  if (targetUser.id === interaction.user.id) {
    await interaction.reply({ content: '❌ No podés transferirte monedas a vos mismo.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (targetUser.bot) {
    await interaction.reply({ content: '❌ No podés transferirle monedas a un bot.', flags: MessageFlags.Ephemeral });
    return;
  }

  const guildId = interaction.guild.id;

  // Chequeo previo ANTES de deferir: así el error de "no te alcanza" puede responderse
  // ephemeral (una vez deferido en público, ya no se puede cambiar). transferBalance
  // sigue siendo la autoridad atómica real — esto es solo para elegir cómo responder.
  const senderEconomy = await getUserEconomy(guildId, interaction.user.id);
  if (senderEconomy.balance < cantidad) {
    await interaction.reply({ content: '❌ No tenés suficientes monedas para esa transferencia.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply();

  // transferBalance hace el chequeo de fondos + resta + suma en una sola transacción
  // atómica (RPC transfer_balance) — si no alcanza, no se descuenta nada de nadie.
  let result;
  try {
    result = await transferBalance(guildId, interaction.user.id, targetUser.id, cantidad);
  } catch (error) {
    if (error.code === 'insufficient_funds') {
      await interaction.editReply({ content: '❌ No tenés suficientes monedas para esa transferencia.' });
      return;
    }
    throw error;
  }

  await Promise.all([
    recordTransaction(guildId, interaction.user.id, {
      type: 'transfer_out',
      amount: -cantidad,
      balanceAfter: result.senderBalance,
      actorId: interaction.user.id,
      reason: `A ${targetUser.tag}`,
    }),
    recordTransaction(guildId, targetUser.id, {
      type: 'transfer_in',
      amount: cantidad,
      balanceAfter: result.receiverBalance,
      actorId: interaction.user.id,
      reason: `De ${interaction.user.tag}`,
    }),
  ]);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('💸 Transferencia realizada')
    .setDescription(`Le transferiste **${cantidad.toLocaleString('es-ES')}** monedas a ${targetUser}.`)
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });

  // Señal de patrón sospechoso (lavado entre alts / cuenta comprometida repartiendo
  // balance) — no bloquea ni avisa al usuario, solo un heads-up silencioso al staff.
  const suspiciousPattern = recordGive(guildId, interaction.user.id, targetUser.id, cantidad);
  if (suspiciousPattern) {
    const logChannel = await getGuildLogChannel(interaction.client, interaction.guildId, 'economy');
    if (logChannel) {
      await logChannel.send({
        embeds: [createGiveSuspiciousLogEmbed({ sender: interaction.user, pattern: suspiciousPattern })],
      });
    }
  }
}
