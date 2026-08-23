import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';

const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

export const data = new SlashCommandBuilder()
  .setName('encuesta')
  .setDescription('Crea una encuesta pública con reacciones.')
  .addStringOption((o) => o.setName('pregunta').setDescription('La pregunta de la encuesta').setRequired(true).setMaxLength(256))
  .addStringOption((o) =>
    o.setName('opciones').setDescription('Separá las opciones con comas (2-10). Si la omitís, es 👍/👎').setRequired(false).setMaxLength(500),
  )
  .setDMPermission(false);

export async function execute(interaction) {
  const pregunta = interaction.options.getString('pregunta');
  const raw = interaction.options.getString('opciones');

  const opciones = raw
    ? raw.split(',').map((o) => o.trim()).filter((o) => o.length > 0)
    : null;

  if (opciones && (opciones.length < 2 || opciones.length > 10)) {
    await interaction.reply({ content: '❌ Necesitás entre 2 y 10 opciones separadas por comas.', flags: MessageFlags.Ephemeral });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('📊 Encuesta')
    .setDescription(opciones ? `**${pregunta}**\n\n${opciones.map((o, i) => `${NUMBER_EMOJIS[i]} ${o}`).join('\n')}` : `**${pregunta}**`)
    .setFooter({ text: `${BRAND_NAME} • Creada por ${interaction.user.tag}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
  const message = await interaction.fetchReply();

  const reactions = opciones ? NUMBER_EMOJIS.slice(0, opciones.length) : ['👍', '👎'];
  for (const emoji of reactions) {
    await message.react(emoji).catch(() => {});
  }
}
