import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getUserXp, getLevelProgress, getRank } from '../../utils/xpStore.js';
import { buildRankCardAttachment } from '../../utils/rankCardImage.js';
import { BRAND_COLOR } from '../../utils/embeds.js';

// Antes esto era un embed con la barra de progreso como texto Unicode. La tarjeta de
// imagen reusa la infraestructura de canvas que ya existía para el banner de bienvenida
// (welcomeImage.js) — mismo patrón de fuentes propias, mismo estilo visual de marca.
export async function buildNivelPayload(guildId, targetUser) {
  const record = await getUserXp(guildId, targetUser.id);
  const progress = getLevelProgress(record.xp);
  const rank = await getRank(guildId, targetUser.id);

  const attachment = await buildRankCardAttachment({ targetUser, progress, rank, prestige: record.prestige });
  const embed = new EmbedBuilder().setColor(BRAND_COLOR).setImage('attachment://rango.png');

  return { embeds: [embed], files: [attachment] };
}

export const data = new SlashCommandBuilder()
  .setName('nivel')
  .setDescription('Muestra tu nivel y progreso de XP (o el de otro usuario).')
  .addUserOption((o) => o.setName('usuario').setDescription('Usuario a consultar (opcional)').setRequired(false))
  .setDMPermission(false);

export async function execute(interaction) {
  await interaction.deferReply();
  const targetUser = interaction.options.getUser('usuario') || interaction.user;
  const payload = await buildNivelPayload(interaction.guild.id, targetUser);
  await interaction.editReply(payload);
}
