// Banco: plata "a salvo" de /rob (que solo puede tocar el wallet), a cambio de un
// interés chico que se calcula solo cuando el usuario mira /bank (no hay cron corriendo
// cada tanto — ver collectBankInterest en economyStore.js).
import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getUserEconomy, depositToBank, withdrawFromBank, collectBankInterest } from '../../utils/economyStore.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { withLock } from '../../utils/asyncLock.js';

async function handleVer(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const { interest } = await withLock(`bank:${interaction.guildId}:${interaction.user.id}`, () =>
    collectBankInterest(interaction.guildId, interaction.user.id),
  );
  const economy = await getUserEconomy(interaction.guildId, interaction.user.id);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🏦 Tu banco')
    .addFields(
      { name: '💵 Wallet (arriesgable por /rob)', value: `${economy.balance.toLocaleString('es-ES')} monedas`, inline: true },
      { name: '🏦 Banco (protegido)', value: `${economy.bank.toLocaleString('es-ES')} monedas`, inline: true },
    )
    .setFooter({ text: `${BRAND_NAME} • El banco rinde 2%/día (tope 14 días acumulados) — se cobra cada vez que mirás /bank` })
    .setTimestamp();

  if (interest > 0) {
    embed.setDescription(`💰 Cobraste **${interest.toLocaleString('es-ES')}** monedas de interés.`);
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleDepositar(interaction) {
  const cantidad = interaction.options.getInteger('cantidad');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await withLock(`bank:${interaction.guildId}:${interaction.user.id}`, async () => {
    let result;
    try {
      result = await depositToBank(interaction.guildId, interaction.user.id, cantidad);
    } catch (error) {
      if (error.code === 'insufficient_funds') {
        await interaction.editReply({ content: '❌ No tenés suficientes monedas en el wallet para depositar eso.' });
        return;
      }
      throw error;
    }
    await interaction.editReply({
      content: `✅ Depositaste **${cantidad.toLocaleString('es-ES')}** monedas.\nWallet: **${result.wallet.toLocaleString('es-ES')}** · Banco: **${result.bank.toLocaleString('es-ES')}**.`,
    });
  });
}

async function handleRetirar(interaction) {
  const cantidad = interaction.options.getInteger('cantidad');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await withLock(`bank:${interaction.guildId}:${interaction.user.id}`, async () => {
    let result;
    try {
      result = await withdrawFromBank(interaction.guildId, interaction.user.id, cantidad);
    } catch (error) {
      if (error.code === 'insufficient_funds') {
        await interaction.editReply({ content: '❌ No tenés suficientes monedas en el banco para retirar eso.' });
        return;
      }
      throw error;
    }
    await interaction.editReply({
      content: `✅ Retiraste **${cantidad.toLocaleString('es-ES')}** monedas.\nWallet: **${result.wallet.toLocaleString('es-ES')}** · Banco: **${result.bank.toLocaleString('es-ES')}**.`,
    });
  });
}

export const data = new SlashCommandBuilder()
  .setName('bank')
  .setDescription('Guardá monedas en el banco — a salvo de /rob, y rinde interés.')
  .addSubcommand((sub) => sub.setName('ver').setDescription('Muestra tu wallet y tu banco (cobra el interés acumulado).'))
  .addSubcommand((sub) =>
    sub
      .setName('depositar')
      .setDescription('Mueve monedas del wallet al banco.')
      .addIntegerOption((o) => o.setName('cantidad').setDescription('Cuánto depositar').setRequired(true).setMinValue(1)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('retirar')
      .setDescription('Mueve monedas del banco al wallet.')
      .addIntegerOption((o) => o.setName('cantidad').setDescription('Cuánto retirar').setRequired(true).setMinValue(1)),
  )
  .setDMPermission(false);

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'ver') return handleVer(interaction);
  if (sub === 'depositar') return handleDepositar(interaction);
  if (sub === 'retirar') return handleRetirar(interaction);
}
