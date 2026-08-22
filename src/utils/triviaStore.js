// MIGRADO A SUPABASE (antes: trivia.json). Toda función es async ahora.
//
// El banco de preguntas (triviaQuestions.js) se queda en código, tal cual estaba —
// no hay ningún comando para administrarlo dinámicamente, así que moverlo a una tabla
// no cambiaría nada funcional, solo agregaría una llamada de red donde antes no hacía
// falta. Lo único que persiste acá es el PROGRESO de cada usuario.
import { supabase } from '../supabaseClient.js';

const TABLE = 'trivia_user_stats';
export const POINTS_PER_CORRECT = 10;
const PLAY_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 horas
export const MAX_PLAYS_PER_WINDOW = 3;

function rowToRecord(row) {
  if (!row) {
    return { points: 0, correct: 0, answered: 0, answeredQuestionIds: [], playsWindowStart: 0, playsInWindow: 0 };
  }
  return {
    points: row.points,
    correct: row.correct,
    answered: row.answered,
    answeredQuestionIds: row.answered_question_ids || [],
    playsWindowStart: row.plays_window_start,
    playsInWindow: row.plays_in_window,
  };
}

export async function getUserTrivia(guildId, userId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('points, correct, answered, answered_question_ids, plays_window_start, plays_in_window')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return rowToRecord(data);
}

export async function saveUserTrivia(guildId, userId, data) {
  const { error } = await supabase.from(TABLE).upsert(
    {
      guild_id: guildId,
      user_id: userId,
      points: data.points,
      correct: data.correct,
      answered: data.answered,
      answered_question_ids: data.answeredQuestionIds,
      plays_window_start: data.playsWindowStart,
      plays_in_window: data.playsInWindow,
    },
    { onConflict: 'guild_id,user_id' },
  );

  if (error) throw error;
}

// Devuelve el top de trivia del servidor, ya ordenado de mayor a menor puntaje
// (lo hace Postgres). "limit" es opcional — /trivia ranking solo necesita el top 10.
export async function getGuildTrivia(guildId, { limit } = {}) {
  let query = supabase
    .from(TABLE)
    .select('user_id, points, correct, answered')
    .eq('guild_id', guildId)
    .order('points', { ascending: false });

  if (limit) query = query.limit(limit);

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map((row) => ({ userId: row.user_id, points: row.points, correct: row.correct, answered: row.answered }));
}

// Elige la próxima pregunta para un usuario: nunca una que ya haya respondido antes,
// y tampoco la que tenga pendiente sin responder ahora mismo (excludeIds), para que
// /trivia jugar dos veces seguidas sin contestar no repita la misma.
// Si ya respondió TODAS las disponibles, reinicia su historial (vuelven a estar
// todas habilitadas) y avisa con historyReset: true para que el comando pueda avisarle.
export async function pickQuestionForUser(guildId, userId, allQuestions, excludeIds = []) {
  const record = await getUserTrivia(guildId, userId);
  const excluded = new Set([...record.answeredQuestionIds, ...excludeIds]);
  let pool = allQuestions.filter((q) => !excluded.has(q.id));
  let historyReset = false;

  if (pool.length === 0) {
    record.answeredQuestionIds = [];
    await saveUserTrivia(guildId, userId, record);
    pool = allQuestions.filter((q) => !excludeIds.includes(q.id));
    historyReset = true;
  }

  const question = pool[Math.floor(Math.random() * pool.length)];
  return { question, historyReset };
}

// Registra que el usuario respondió una pregunta: la suma al historial (para que no
// vuelva a aparecerle) y, si acertó, suma puntos + el contador de correctas.
// Devuelve el registro actualizado del usuario.
export async function recordAnswer(guildId, userId, questionId, isCorrect) {
  const record = await getUserTrivia(guildId, userId);

  if (!record.answeredQuestionIds.includes(questionId)) {
    record.answeredQuestionIds.push(questionId);
  }
  record.answered += 1;
  if (isCorrect) {
    record.correct += 1;
    record.points += POINTS_PER_CORRECT;
  }

  await saveUserTrivia(guildId, userId, record);
  return record;
}

// Solo consulta si puede jugar ahora — no consume ningún intento. Si la ventana de
// 4hs desde el primer intento ya venció, se considera reiniciada (sin escribir nada
// todavía; eso lo hace registerPlay() al confirmarse que sí se va a jugar).
export async function getPlayStatus(guildId, userId) {
  const record = await getUserTrivia(guildId, userId);
  const now = Date.now();
  const windowExpired = now - record.playsWindowStart >= PLAY_WINDOW_MS;
  const playsUsed = windowExpired ? 0 : record.playsInWindow;
  const remaining = MAX_PLAYS_PER_WINDOW - playsUsed;

  return {
    allowed: remaining > 0,
    remaining: Math.max(0, remaining),
    resetAt: windowExpired ? null : record.playsWindowStart + PLAY_WINDOW_MS,
  };
}

// Consume un intento de juego (llamar justo antes de mostrar la pregunta, no antes
// de saber que se la va a mostrar). Si la ventana anterior ya venció, arranca una nueva.
export async function registerPlay(guildId, userId) {
  const record = await getUserTrivia(guildId, userId);
  const now = Date.now();
  const windowExpired = now - record.playsWindowStart >= PLAY_WINDOW_MS;

  if (windowExpired) {
    record.playsWindowStart = now;
    record.playsInWindow = 1;
  } else {
    record.playsInWindow += 1;
  }

  await saveUserTrivia(guildId, userId, record);
  return record;
}
