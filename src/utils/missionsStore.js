// QUÉ CAMBIÓ: archivo nuevo. Misiones diarias/semanales, enganchadas al Event Engine
// (eventBus.js) — se completan y pagan solas, sin ningún /mision reclamar.
// MOTIVO: auditoría 2026-08-29 (Diagnóstico Nexo, Parte 10 y Parte 22, Fase 3).
//
// DECISIONES QUE SE DESVÍAN DEL PEDIDO ORIGINAL, a propósito:
// 1. Sin tabla `mission_definitions`: el catálogo (qué misiones existen, objetivo,
//    recompensa) vive fijo en código, más abajo — mismo criterio que ACHIEVEMENTS en
//    achievements.js ("cosmético, no vale la pena la superficie de admin"). Menos
//    tablas, menos superficie, y es exactamente el patrón que este proyecto ya usa para
//    algo con la misma forma (una lista fija de "logros/misiones con objetivo y premio").
// 2. Sin /mision reclamar: la recompensa se paga en el mismo instante en que la misión
//    se completa (ver increment_mission_progress en schema.sql), igual que un logro se
//    desbloquea solo al cumplir la condición. Un paso de "reclamar" manual sería el
//    único lugar de todo el bot que pide una acción extra después de cumplir un
//    objetivo — inconsistente con logros, subida de nivel y etapas de mascota, que
//    nunca lo piden.
// 3. Sin misiones "seasonal": la auditoría (Parte 16) recomendó explícitamente NO
//    construir temporadas todavía — meter el campo acá sin nada real detrás sería
//    scope creep contra esa misma recomendación.
// 4. Sin /mision ranking en esta primera versión: requeriría un contador de por vida
//    separado del progreso por período — se puede sumar después sin romper nada de lo
//    que hay acá, no vale la pena adelantarlo sin uso real todavía.
//
// VERIFICACIÓN: /mision ver muestra 3 misiones diarias + 2 semanales con progreso 0 la
// primera vez que se corre. Mandar mensajes/ganar monedas/subir de nivel/acertar
// trivia hace avanzar la barra correspondiente sin que el usuario haga nada más; al
// llegar al objetivo, el balance y la XP suben solos (mismo followUp que ya usan
// daily/work, no un mensaje nuevo).
import { supabase } from '../supabaseClient.js';
import { eventBus } from './eventBus.js';
import { addBalance } from './economyStore.js';
import { addXp } from './xpStore.js';

const TABLE = 'user_missions';
const DAY_MS = 24 * 60 * 60 * 1000;

export const MISSION_CATALOG = [
  { id: 'daily_messages', period: 'daily', description: 'Mandá 15 mensajes que den XP', target: 15, rewardCoins: 50, rewardXp: 15 },
  { id: 'daily_trivia', period: 'daily', description: 'Respondé 1 pregunta de /trivia correctamente', target: 1, rewardCoins: 40, rewardXp: 0 },
  { id: 'daily_earn', period: 'daily', description: 'Ganá 150 monedas (cualquier fuente)', target: 150, rewardCoins: 60, rewardXp: 10 },
  { id: 'weekly_level', period: 'weekly', description: 'Subí al menos 1 nivel', target: 1, rewardCoins: 300, rewardXp: 0 },
  { id: 'weekly_earn', period: 'weekly', description: 'Ganá 1.000 monedas', target: 1000, rewardCoins: 500, rewardXp: 0 },
];
const MISSION_BY_ID = new Map(MISSION_CATALOG.map((m) => [m.id, m]));

// Día/semana UTC — mismo criterio que isWeekendUTC() en xpEngine.js: no hay forma de
// saber la zona horaria de una comunidad, UTC es lo único no ambiguo.
function getDailyPeriodStart(now = Date.now()) {
  return Math.floor(now / DAY_MS) * DAY_MS;
}
function getWeeklyPeriodStart(now = Date.now()) {
  const dayStart = getDailyPeriodStart(now);
  const dayOfWeek = new Date(dayStart).getUTCDay(); // 0=domingo … 6=sábado
  const daysSinceMonday = (dayOfWeek + 6) % 7; // lunes=0
  return dayStart - daysSinceMonday * DAY_MS;
}
function periodStartFor(period) {
  return period === 'daily' ? getDailyPeriodStart() : getWeeklyPeriodStart();
}

function rowToMission(row) {
  const def = MISSION_BY_ID.get(row.mission_id);
  return {
    id: row.mission_id,
    period: row.period,
    description: def?.description ?? row.mission_id,
    progress: row.progress,
    target: row.target,
    rewardCoins: row.reward_coins,
    rewardXp: row.reward_xp,
    completedAt: row.completed_at,
  };
}

// Idempotente: upsert con ignoreDuplicates, así se puede llamar tanto desde /mision ver
// como desde cada handler de evento sin duplicar filas ni pisar progreso ya existente.
async function ensureCurrentMissions(guildId, userId) {
  const rows = MISSION_CATALOG.map((m) => ({
    guild_id: guildId,
    user_id: userId,
    mission_id: m.id,
    period: m.period,
    period_start: periodStartFor(m.period),
    progress: 0,
    target: m.target,
    reward_coins: m.rewardCoins,
    reward_xp: m.rewardXp,
  }));

  const { error } = await supabase.from(TABLE).upsert(rows, { onConflict: 'guild_id,user_id,mission_id,period_start', ignoreDuplicates: true });
  if (error) throw error;
}

// Usado por /mision ver — trae las 5 instancias del ciclo ACTUAL (no el historial).
export async function getUserMissions(guildId, userId) {
  await ensureCurrentMissions(guildId, userId);

  const currentStarts = [getDailyPeriodStart(), getWeeklyPeriodStart()];
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .in('period_start', currentStarts);

  if (error) throw error;
  return (data || []).map(rowToMission);
}

// Motor de progreso: lo llaman los handlers de eventos de más abajo, nunca un comando
// directamente. Paga la recompensa apenas la RPC confirma que ESTA llamada completó la
// misión (just_completed) — así dos eventos casi simultáneos no pagan doble.
async function incrementMissionProgress(guildId, userId, missionId, amount) {
  const def = MISSION_BY_ID.get(missionId);
  if (!def) return;

  await ensureCurrentMissions(guildId, userId);

  const { data, error } = await supabase.rpc('increment_mission_progress', {
    p_guild_id: guildId,
    p_user_id: userId,
    p_mission_id: missionId,
    p_period_start: periodStartFor(def.period),
    p_amount: amount,
    p_now: Date.now(),
  });
  if (error) throw error;

  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.just_completed) return;

  // addBalance/addXp ya son atómicos por su cuenta — no hace falta reimplementar el
  // pago dentro de la RPC de arriba, solo dispararlo una vez que ella confirma que
  // corresponde.
  if (result.reward_coins > 0) await addBalance(guildId, userId, result.reward_coins, { type: 'mission', reason: def.description });
  if (result.reward_xp > 0) await addXp(guildId, userId, result.reward_xp);
}

// Para el dashboard (Fase 5) — cuántos usuarios DISTINTOS completaron al menos una
// misión en el ciclo actual (no cuántas misiones en total: alguien que completó las 3
// diarias cuenta una sola vez). Vive acá y no en dashboard/queries.js para no duplicar
// el cálculo de period_start en dos archivos.
export async function getGuildMissionCompletionSummary(guildId) {
  const [dailyRows, weeklyRows] = await Promise.all([
    supabase.from(TABLE).select('user_id').eq('guild_id', guildId).eq('period_start', getDailyPeriodStart()).not('completed_at', 'is', null),
    supabase.from(TABLE).select('user_id').eq('guild_id', guildId).eq('period_start', getWeeklyPeriodStart()).not('completed_at', 'is', null),
  ]);
  if (dailyRows.error) throw dailyRows.error;
  if (weeklyRows.error) throw weeklyRows.error;

  return {
    dailyCompletedUsers: new Set((dailyRows.data || []).map((r) => r.user_id)).size,
    weeklyCompletedUsers: new Set((weeklyRows.data || []).map((r) => r.user_id)).size,
  };
}

function logMissionError(missionId, error) {
  console.error(`❌ Error actualizando progreso de misión '${missionId}':`, error);
}

// --- Handlers del Event Engine — cada uno mapea un evento de dominio a la(s) misión(es)
// que le corresponden. Registrados acá (no en cada feature de origen) porque esta es la
// infraestructura de misiones, no la de mensajes/economía/XP/trivia.

eventBus.on('XP_GAINED', async ({ guildId, userId, source }) => {
  if (source !== 'message') return; // voz, trivia o /xp de staff no cuentan para "mandá N mensajes"
  await incrementMissionProgress(guildId, userId, 'daily_messages', 1).catch((error) => logMissionError('daily_messages', error));
});

eventBus.on('COINS_EARNED', async ({ guildId, userId, amount }) => {
  await Promise.all([
    incrementMissionProgress(guildId, userId, 'daily_earn', amount).catch((error) => logMissionError('daily_earn', error)),
    incrementMissionProgress(guildId, userId, 'weekly_earn', amount).catch((error) => logMissionError('weekly_earn', error)),
  ]);
});

eventBus.on('LEVEL_UP', async ({ guildId, userId }) => {
  await incrementMissionProgress(guildId, userId, 'weekly_level', 1).catch((error) => logMissionError('weekly_level', error));
});

eventBus.on('TRIVIA_CORRECT', async ({ guildId, userId }) => {
  await incrementMissionProgress(guildId, userId, 'daily_trivia', 1).catch((error) => logMissionError('daily_trivia', error));
});
