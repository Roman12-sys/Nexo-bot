import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import TRIVIA_QUESTIONS from '../../utils/triviaQuestions.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { startSession, getSession, clearSession } from '../../utils/guessSessions.js';
import {
  pickQuestionForUser,
  getGuildTrivia,
  getPlayStatus,
  registerPlay,
  recordAnswer,
  MAX_PLAYS_PER_WINDOW,
  POINTS_PER_CORRECT,
} from '../../utils/triviaStore.js';
import { withLock } from '../../utils/asyncLock.js';
import { unlockAchievement, announceUnlockedAchievements } from '../../utils/achievements.js';
import { registerButtonPrefix } from '../../components/buttons.js';

const LETTERS = ['🇦', '🇧', '🇨', '🇩'];

async function handleJugar(interaction) {
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const sessionKey = `trivia:${guildId}:${userId}`;

  await interaction.deferReply();

  // Si ya hay una pregunta pendiente, no se arranca una nueva — antes esto pisaba la
  // sesión vieja (sus botones quedaban huérfanos, "ya expiró") pero el intento ya se
  // había gastado igual. Ahora ese intento se conserva hasta que responda la pendiente.
  if (getSession(sessionKey)) {
    await interaction.editReply({
      content: '⚠️ Ya tenés una pregunta de trivia sin responder — contestá esa primero (los botones siguen activos en ese mensaje).',
    });
    return;
  }

  const status = await withLock(sessionKey, async () => {
    const current = await getPlayStatus(guildId, userId);
    if (!current.allowed) return current;

    await registerPlay(guildId, userId);
    return current;
  });

  if (!status.allowed) {
    await interaction.editReply({
      content: `⏳ Ya jugaste ${MAX_PLAYS_PER_WINDOW} veces de trivia en las últimas 4 horas. Podés volver a jugar <t:${Math.floor(status.resetAt / 1000)}:R>.`,
    });
    return;
  }

  const { question: q, historyReset } = await pickQuestionForUser(guildId, userId, TRIVIA_QUESTIONS, []);

  const remainingAfter = status.remaining - 1;
  const footerParts = [
    historyReset ? '¡Respondiste todas las preguntas! Empieza un nuevo ciclo' : null,
    `Te quedan ${remainingAfter}/${MAX_PLAYS_PER_WINDOW} intentos en las próximas 4hs`,
    'Solo vos podés responder esta trivia',
  ].filter(Boolean);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🧠 Trivia')
    .setDescription(`**${q.question}**\n\n${q.options.map((opt, i) => `${LETTERS[i]} ${opt}`).join('\n')}`)
    .setFooter({ text: `${BRAND_NAME} • ${footerParts.join(' • ')}` })
    .setTimestamp();

  startSession(sessionKey, { questionId: q.id, correctIndex: q.correct });

  const row = new ActionRowBuilder().addComponents(
    q.options.map((_, i) =>
      new ButtonBuilder()
        .setCustomId(`trivia_${userId}_${q.id}_${i}`)
        .setLabel(LETTERS[i])
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
}

async function handleRanking(interaction) {
  await interaction.deferReply();

  const sorted = (await getGuildTrivia(interaction.guild.id, { limit: 10 })).filter((data) => data.points > 0);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🏆 Ranking de Trivia')
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();

  if (sorted.length === 0) {
    embed.setDescription('Todavía nadie sumó puntos de trivia.');
  } else {
    const medals = ['🥇', '🥈', '🥉'];
    const lines = sorted.map((data, index) => {
      const medal = medals[index] || `#${index + 1}`;
      return `${medal} <@${data.userId}> — **${data.points}** puntos (${data.correct}/${data.answered} correctas)`;
    });
    embed.setDescription(lines.join('\n'));
  }

  await interaction.editReply({ embeds: [embed] });
}

export const data = new SlashCommandBuilder()
  .setName('trivia')
  .setDescription('Sistema de trivia: respondé preguntas y ganá puntos.')
  .addSubcommand((sub) => sub.setName('jugar').setDescription('Respondé una pregunta de trivia.'))
  .addSubcommand((sub) => sub.setName('ranking').setDescription('Muestra el ranking de puntos de trivia.'))
  .setDMPermission(false);

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'jugar') return handleJugar(interaction);
  if (sub === 'ranking') return handleRanking(interaction);
}

registerButtonPrefix('trivia_', async (interaction) => {
  const [, starterId, questionIdStr, clickedStr] = interaction.customId.split('_');

  if (interaction.user.id !== starterId) {
    await interaction.reply({ content: '❌ Esta trivia no es tuya. Iniciá la tuya con /trivia jugar.', flags: MessageFlags.Ephemeral });
    return;
  }

  const sessionKey = `trivia:${interaction.guild.id}:${starterId}`;
  const session = getSession(sessionKey);
  if (!session || String(session.secret.questionId) !== questionIdStr) {
    await interaction.update({ components: [] }).catch(() => {});
    await interaction.followUp({ content: '⚠️ Esta trivia ya expiró o ya fue respondida.', flags: MessageFlags.Ephemeral });
    return;
  }
  clearSession(sessionKey);

  const { questionId, correctIndex } = session.secret;
  const clicked = parseInt(clickedStr, 10);
  const isCorrect = correctIndex === clicked;

  await interaction.update({ components: [] });

  // Mismo lock que registerPlay (asyncLock.js) — recordAnswer también hace lectura +
  // upsert de fila completa sobre trivia_user_stats, así que tiene que serializarse
  // contra un /trivia jugar concurrente del mismo usuario para no pisarse los campos.
  const record = await withLock(sessionKey, () => recordAnswer(interaction.guild.id, interaction.user.id, questionId, isCorrect));

  if (isCorrect) {
    await interaction.followUp({
      content: `✅ ¡Correcto! Ganaste **${POINTS_PER_CORRECT}** puntos de trivia. Total: **${record.points}** (${record.correct}/${record.answered} correctas).`,
      flags: MessageFlags.Ephemeral,
    });

    if (record.correct >= 10) {
      await announceUnlockedAchievements(interaction, interaction.user.id, [
        unlockAchievement(interaction.guild.id, interaction.user.id, 'sabelotodo'),
      ]);
    }
  } else {
    await interaction.followUp({
      content: `❌ Incorrecto. La respuesta correcta era la opción ${LETTERS[correctIndex]}. Puntos de trivia: **${record.points}**.`,
      flags: MessageFlags.Ephemeral,
    });
  }
});
