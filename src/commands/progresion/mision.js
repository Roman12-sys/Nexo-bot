// QUÉ CAMBIÓ: archivo nuevo (y categoría nueva, src/commands/progresion/ — index.js
// descubre carpetas de comandos dinámicamente con fs.readdirSync, no hizo falta tocar
// nada más para que este comando cargue).
// MOTIVO: auditoría 2026-08-29 (Diagnóstico Nexo, Parte 10, Fase 3).
// VERIFICACIÓN: /mision muestra 3 misiones diarias + 2 semanales con progreso; una vez
// completada, aparece marcada con ✅ y no sigue sumando de más.
import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getUserMissions } from '../../utils/missionsStore.js';
import { BRAND_COLOR, BRAND_NAME, buildProgressBar } from '../../utils/embeds.js';

function formatMission(m) {
  const done = m.completedAt !== null;
  const shownProgress = Math.min(m.progress, m.target);
  const bar = buildProgressBar(shownProgress, m.target);

  const rewardParts = [];
  if (m.rewardCoins > 0) rewardParts.push(`${m.rewardCoins.toLocaleString('es-ES')} monedas`);
  if (m.rewardXp > 0) rewardParts.push(`${m.rewardXp} XP`);
  const rewardText = rewardParts.join(' + ');

  const statusLine = done ? `✅ Completada — ${rewardText} ya acreditados` : `${bar} ${shownProgress}/${m.target} · recompensa: ${rewardText}`;
  return `${done ? '✅' : '⬜'} **${m.description}**\n${statusLine}`;
}

export const data = new SlashCommandBuilder()
  .setName('mision')
  .setDescription('Misiones diarias y semanales — se completan y pagan solas al cumplir el objetivo.')
  .setDMPermission(false);

export async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const missions = await getUserMissions(interaction.guildId, interaction.user.id);
  const daily = missions.filter((m) => m.period === 'daily');
  const weekly = missions.filter((m) => m.period === 'weekly');

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🗓️ Tus misiones')
    .addFields(
      { name: '☀️ Diarias — se reinician cada día (UTC)', value: daily.map(formatMission).join('\n\n') },
      { name: '📅 Semanales — se reinician cada lunes (UTC)', value: weekly.map(formatMission).join('\n\n') },
    )
    .setFooter({ text: `${BRAND_NAME} • Las recompensas se pagan solas al completar cada misión, sin nada que reclamar` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
