import { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getNextConfessionNumber } from '../../utils/confessionStore.js';
import { getGuildConfig } from '../../utils/guildConfigStore.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { registerModalPrefix } from '../../components/modals.js';

function buildConfessionModal() {
  const modal = new ModalBuilder().setCustomId('modal_confession').setTitle('Confesión anónima');
  const mensaje = new TextInputBuilder()
    .setCustomId('mensaje')
    .setLabel('Tu confesión (se publica de forma anónima)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000);
  modal.addComponents(new ActionRowBuilder().addComponents(mensaje));
  return modal;
}

export const data = new SlashCommandBuilder()
  .setName('confession')
  .setDescription('Enviá una confesión anónima al canal de confesiones.')
  .setDMPermission(false);

export async function execute(interaction) {
  await interaction.showModal(buildConfessionModal());
}

registerModalPrefix('modal_confession', async (i) => {
  const cfg = await getGuildConfig(i.guildId);
  if (!cfg.confession_channel_id) {
    await i.reply({ content: '⚠️ El canal de confesiones no está configurado. Un admin puede activarlo con `/config canal-confesiones`.', flags: MessageFlags.Ephemeral });
    return;
  }

  const mensaje = i.fields.getTextInputValue('mensaje');
  const confessionChannel = await i.client.channels.fetch(cfg.confession_channel_id).catch(() => null);
  if (!confessionChannel || !confessionChannel.isTextBased()) {
    await i.reply({ content: '⚠️ No se pudo acceder al canal de confesiones.', flags: MessageFlags.Ephemeral });
    return;
  }

  const number = await getNextConfessionNumber(i.guildId);
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`🤫 Confesión #${number}`)
    .setDescription(mensaje)
    .setFooter({ text: `${BRAND_NAME} • Anónimo` })
    .setTimestamp();

  await confessionChannel.send({ embeds: [embed] });

  const logChannel = await getGuildLogChannel(i.client, i.guildId, 'moderation');
  if (logChannel) {
    const logEmbed = new EmbedBuilder()
      .setColor('#6C757D')
      .setTitle(`🔒 Registro privado — Confesión #${number}`)
      .setDescription('Solo para moderación. La confesión se publicó de forma anónima en el canal público.')
      .addFields({ name: 'Autor real', value: `${i.user.tag} (\`${i.user.id}\`)` })
      .setTimestamp();
    await logChannel.send({ embeds: [logEmbed] });
  }

  await i.reply({ content: '✅ Tu confesión fue publicada de forma anónima.', flags: MessageFlags.Ephemeral });
});
