import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getUserReputation, addReputation, touchLastGiven } from '../../utils/reputationStore.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { withLock } from '../../utils/asyncLock.js';

const COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 horas entre cada vez que PODÉS dar reputación

export const data = new SlashCommandBuilder()
  .setName('reputation')
  .setDescription('Le das un punto de reputación a otro usuario.')
  .addUserOption((o) => o.setName('usuario').setDescription('A quién le das reputación').setRequired(true))
  .setDMPermission(false);

export async function execute(interaction) {
  const targetUser = interaction.options.getUser('usuario');
  const guildId = interaction.guild.id;

  if (targetUser.id === interaction.user.id) {
    await interaction.reply({ content: '❌ No podés darte reputación a vos mismo.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (targetUser.bot) {
    await interaction.reply({ content: '❌ No podés darle reputación a un bot.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply();

  // Check de cooldown + reclamo dentro de un lock por usuario (mismo motivo que /daily
  // y /work): sin esto, dos /reputation casi simultáneos del mismo usuario dador pueden
  // leer el mismo lastGiven viejo antes de que el primero llegue a actualizarlo.
  const result = await withLock(`reputation:${guildId}:${interaction.user.id}`, async () => {
    const giver = await getUserReputation(guildId, interaction.user.id);
    const now = Date.now();
    const elapsed = now - giver.lastGiven;

    if (elapsed < COOLDOWN_MS) {
      return { onCooldown: true, remaining: COOLDOWN_MS - elapsed, now };
    }

    // touchLastGiven solo toca la columna del cooldown del que da; addReputation suma
    // el punto de forma atómica — ninguna de las dos puede pisar un cambio concurrente
    // del total de cualquiera de los dos usuarios (ej. otro /reputation al mismo receptor).
    await touchLastGiven(guildId, interaction.user.id, now);
    const newTotal = await addReputation(guildId, targetUser.id, 1);

    return { onCooldown: false, newTotal };
  });

  if (result.onCooldown) {
    const readyTimestamp = Math.floor((result.now + result.remaining) / 1000);
    await interaction.editReply({
      content: `⏳ Ya diste reputación hace poco. Podés volver a dar <t:${readyTimestamp}:R>.`,
    });
    return;
  }

  const { newTotal } = result;
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setDescription(`⭐ ${interaction.user} le dio un punto de reputación a ${targetUser}.\n${targetUser.tag} ahora tiene **${newTotal}** punto(s) de reputación.`)
    .setFooter({ text: BRAND_NAME });

  await interaction.editReply({ embeds: [embed] });
}
