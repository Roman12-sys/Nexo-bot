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
  getUserTrivia,
  MAX_PLAYS_PER_WINDOW,
  POINTS_PER_CORRECT,
} from '../../utils/triviaStore.js';
import { withLock } from '../../utils/asyncLock.js';
import { eventBus } from '../../utils/eventBus.js'; // Event Engine — auditoría 2026-08-29, Parte 7
import { registerButtonPrefix } from '../../components/buttons.js';
import { addBalance } from '../../utils/economyStore.js';
import { addXp } from '../../utils/xpStore.js';
import { processLevelUp } from '../../utils/xpEngine.js';
import { getGuildConfig } from '../../utils/guildConfigStore.js';

const LETTERS = ['🇦', '🇧', '🇨', '🇩'];

// QUÉ CAMBIÓ: trivia ahora da monedas y XP por respuesta correcta, no solo puntos
// propios de trivia (que se mantienen igual que siempre, ver POINTS_PER_CORRECT).
// MOTIVO: auditoría 2026-08-29 (Diagnóstico Nexo, Parte 5) — trivia era una isla:
// tenía su propio sistema de puntos sin ningún cruce con economía o XP. Montos bajos
// a propósito (comparar contra /work: 50-150, o XP por mensaje: 15-25) para no
// convertir trivia en la forma más eficiente de progresar — sigue siendo un extra, no
// un reemplazo de /work ni de chatear.
// VERIFICACIÓN: responder correcto en /trivia sube el balance (/balance) y la XP
// (/nivel) del usuario, salvo que el servidor tenga el módulo de XP apagado
// (guild_config.features.xp) — ahí solo suben monedas y puntos de trivia, igual que
// messageCreate.js respeta ese mismo toggle para XP por mensaje.
const MIN_TRIVIA_XP = 5;
const MAX_TRIVIA_XP = 10;
const MIN_TRIVIA_COINS = 10;
const MAX_TRIVIA_COINS = 25;

async function handleJugar(interaction) {
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const sessionKey = `trivia:${guildId}:${userId}`;
  const dificultad = interaction.options.getString('dificultad');

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

  // El campo "difficulty" de cada pregunta existía desde siempre pero nada lo usaba —
  // esto es lo único que cambia si se filtra: el pool que ve pickQuestionForUser.
  const pool = dificultad ? TRIVIA_QUESTIONS.filter((question) => question.difficulty === dificultad) : TRIVIA_QUESTIONS;
  const { question: q, historyReset } = await pickQuestionForUser(guildId, userId, pool, []);

  // Antes solo se avisaba al terminar el ciclo entero ("¡respondiste todas!") — esto
  // muestra el progreso en cada pregunta, no solo al final. Se relee el registro DESPUÉS
  // de pickQuestionForUser porque ese puede haber reseteado el historial (historyReset).
  const freshRecord = await getUserTrivia(guildId, userId);
  const answeredSet = new Set(freshRecord.answeredQuestionIds);
  const unanswered = pool.filter((question) => !answeredSet.has(question.id)).length;

  const remainingAfter = status.remaining - 1;
  const footerParts = [
    historyReset ? '¡Respondiste todas las preguntas! Empieza un nuevo ciclo' : `${unanswered}/${pool.length} preguntas sin responder`,
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

const RANKING_PAGE_SIZE = 10;
const MEDALS = ['🥇', '🥈', '🥉'];

// Mismo patrón que buildLeaderboardEmbed (economia/leaderboard.js) — antes esto cortaba
// directo en el top 10 sin forma de ver más.
async function buildTriviaRankingEmbed(guildId, page) {
  const sorted = (await getGuildTrivia(guildId)).filter((data) => data.points > 0);

  const totalPages = Math.max(1, Math.ceil(sorted.length / RANKING_PAGE_SIZE));
  const clampedPage = Math.min(Math.max(0, page), totalPages - 1);
  const slice = sorted.slice(clampedPage * RANKING_PAGE_SIZE, clampedPage * RANKING_PAGE_SIZE + RANKING_PAGE_SIZE);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🏆 Ranking de Trivia')
    .setFooter({ text: `${BRAND_NAME} • Página ${clampedPage + 1}/${totalPages}` })
    .setTimestamp();

  if (slice.length === 0) {
    embed.setDescription('Todavía nadie sumó puntos de trivia.');
  } else {
    const lines = slice.map((data, i) => {
      const globalIndex = clampedPage * RANKING_PAGE_SIZE + i;
      const medal = MEDALS[globalIndex] || `${globalIndex + 1}.`;
      return `${medal} <@${data.userId}> — **${data.points}** puntos (${data.correct}/${data.answered} correctas)`;
    });
    embed.setDescription(lines.join('\n'));
  }

  return { embed, clampedPage, totalPages };
}

function buildTriviaRankingRow(clampedPage, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`trivia_ranking_page_${clampedPage - 1}`)
      .setLabel('◀️ Anterior')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clampedPage <= 0),
    new ButtonBuilder()
      .setCustomId(`trivia_ranking_page_${clampedPage + 1}`)
      .setLabel('Siguiente ▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clampedPage >= totalPages - 1),
  );
}

async function handleRanking(interaction) {
  await interaction.deferReply();
  const { embed, clampedPage, totalPages } = await buildTriviaRankingEmbed(interaction.guild.id, 0);
  const components = totalPages > 1 ? [buildTriviaRankingRow(clampedPage, totalPages)] : [];
  await interaction.editReply({ embeds: [embed], components });
}

registerButtonPrefix('trivia_ranking_page_', async (interaction) => {
  const page = parseInt(interaction.customId.slice('trivia_ranking_page_'.length), 10);
  const { embed, clampedPage, totalPages } = await buildTriviaRankingEmbed(interaction.guild.id, page);
  await interaction.update({ embeds: [embed], components: [buildTriviaRankingRow(clampedPage, totalPages)] });
});

export const data = new SlashCommandBuilder()
  .setName('trivia')
  .setDescription('Sistema de trivia: respondé preguntas y ganá puntos.')
  .addSubcommand((sub) =>
    sub
      .setName('jugar')
      .setDescription('Respondé una pregunta de trivia.')
      .addStringOption((o) =>
        o
          .setName('dificultad')
          .setDescription('Filtrar por dificultad (por defecto, cualquiera)')
          .setRequired(false)
          .addChoices({ name: 'Fácil', value: 'facil' }, { name: 'Medio', value: 'medio' }, { name: 'Difícil', value: 'dificil' }),
      ),
  )
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
    // Evento propio (no XP_GAINED con source:'trivia'): si el server tiene el módulo de
    // XP apagado, addXp ni se llama más abajo — la misión "respondé trivia" no debería
    // depender de un toggle que no tiene nada que ver con ella.
    await eventBus.emit('TRIVIA_CORRECT', { guildId: interaction.guild.id, userId: interaction.user.id });

    const coinsGained = Math.floor(Math.random() * (MAX_TRIVIA_COINS - MIN_TRIVIA_COINS + 1)) + MIN_TRIVIA_COINS;
    const xpGained = Math.floor(Math.random() * (MAX_TRIVIA_XP - MIN_TRIVIA_XP + 1)) + MIN_TRIVIA_XP;

    const cfg = await getGuildConfig(interaction.guild.id);
    const [, xpResult] = await Promise.all([
      addBalance(interaction.guild.id, interaction.user.id, coinsGained, { type: 'trivia', reason: 'Respuesta correcta en /trivia' }),
      cfg.features?.xp ? addXp(interaction.guild.id, interaction.user.id, xpGained) : Promise.resolve(null),
    ]);

    const xpLine = xpResult ? ` y **${xpGained}** XP` : '';
    await interaction.followUp({
      content: `✅ ¡Correcto! Ganaste **${POINTS_PER_CORRECT}** puntos de trivia, **${coinsGained}** monedas${xpLine}. Total: **${record.points}** puntos de trivia (${record.correct}/${record.answered} correctas).`,
      flags: MessageFlags.Ephemeral,
    });

    if (xpResult?.leveledUp) {
      await processLevelUp(
        interaction.member,
        { previousLevel: xpResult.previousLevel, newLevel: xpResult.newLevel, totalXp: xpResult.record.xp },
        interaction.client,
      ).catch((error) => console.error('❌ Error procesando subida de nivel (trivia):', error));
    }

    if (record.correct >= 10) {
      await eventBus.emit('ACHIEVEMENT_CHECK', { guildId: interaction.guild.id, userId: interaction.user.id, achievementId: 'sabelotodo', interaction });
    }
  } else {
    await interaction.followUp({
      content: `❌ Incorrecto. La respuesta correcta era la opción ${LETTERS[correctIndex]}. Puntos de trivia: **${record.points}**.`,
      flags: MessageFlags.Ephemeral,
    });
  }
});
