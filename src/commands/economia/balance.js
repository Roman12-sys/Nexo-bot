import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getUserEconomy } from '../../utils/economyStore.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('balance')
  .setDescription('Muestra cuántas monedas tenés (o las de otro usuario).')
  .addUserOption((o) => o.setName('usuario').setDescription('Usuario a consultar (opcional)').setRequired(false))
  .setDMPermission(false);

export async function execute(interaction) {
  await interaction.deferReply();

  const targetUser = interaction.options.getUser('usuario') || interaction.user;
  const economy = await getUserEconomy(interaction.guild.id, targetUser.id);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`💰 Balance de ${targetUser.tag}`)
    .setDescription(`**${economy.balance.toLocaleString('es-ES')}** monedas`)
    .setThumbnail(targetUser.displayAvatarURL())
    .setFooter({ text: economy.bank > 0 ? `${BRAND_NAME} • + ${economy.bank.toLocaleString('es-ES')} en el banco (usá /bank ver)` : BRAND_NAME })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
