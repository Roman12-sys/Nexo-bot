// QUÉ CAMBIÓ: archivo nuevo. Analítica diaria por servidor para el dashboard (Fase 5).
// MOTIVO: auditoría 2026-08-29 (Diagnóstico Nexo, Parte 14/22).
//
// DESVÍO DEL PEDIDO ORIGINAL, a propósito: el pedido original pedía un cron nocturno
// que "sume las métricas del día" — pero no existe ningún otro lugar del esquema donde
// ya viva "cuántos mensajes hubo hoy" o "cuántos comandos corrieron hoy" para que un
// job los agregue después. La única forma correcta de tener esta granularidad es
// incrementar EN VIVO a medida que cada evento pasa, no "calcularla" retroactivamente
// de datos que no existen. Por eso esto son handlers del Event Engine, no un
// setInterval — no hace falta ningún job ni startXStatsLoop() en ready.js, solo que
// este archivo se importe una vez al bootear (ver el import en ready.js).
//
// VERIFICACIÓN: mandar un mensaje, correr un comando, ganar monedas/XP o sumarse un
// miembro nuevo, y confirmar que la fila de guild_daily_stats de HOY (fecha UTC) subió
// la columna correspondiente.
import { supabase } from '../supabaseClient.js';
import { eventBus } from './eventBus.js';
import { utcDateString } from './timePeriods.js';

const TABLE = 'guild_daily_stats';

async function bump(guildId, patch) {
  const { error } = await supabase.rpc('increment_guild_daily_stat', {
    p_guild_id: guildId,
    p_date: utcDateString(),
    p_messages: patch.messages || 0,
    p_commands: patch.commands || 0,
    p_new_members: patch.newMembers || 0,
    p_money: patch.money || 0,
    p_xp: patch.xp || 0,
    p_money_destroyed: patch.moneyDestroyed || 0,
  });
  if (error) throw error;
}

// Usado por el dashboard — historial de los últimos "days" días (incluyendo hoy, que
// todavía puede estar incompleto si se consulta a mitad de jornada).
export async function getGuildDailyStats(guildId, days = 14) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from(TABLE)
    .select('date, messages_sent, commands_executed, new_members, money_created, money_destroyed, xp_distributed')
    .eq('guild_id', guildId)
    .gte('date', since)
    .order('date', { ascending: true });

  if (error) throw error;
  return (data || []).map((row) => ({
    date: row.date,
    messagesSent: row.messages_sent,
    commandsExecuted: row.commands_executed,
    newMembers: row.new_members,
    moneyCreated: Number(row.money_created),
    // money_destroyed no existía antes de Fase A (2026-08-30) — filas viejas no tienen
    // la columna poblada todavía si la migración no corrió, 0 es "no se registró nada".
    moneyDestroyed: Number(row.money_destroyed || 0),
    xpDistributed: Number(row.xp_distributed),
  }));
}

function logStatError(metric, guildId, error) {
  console.error(`❌ Error actualizando guild_daily_stats (${metric}, guild ${guildId}):`, error);
}

eventBus.on('MESSAGE_SENT', async ({ guildId }) => {
  await bump(guildId, { messages: 1 }).catch((error) => logStatError('messages_sent', guildId, error));
});

eventBus.on('COMMAND_EXECUTED', async ({ guildId }) => {
  if (!guildId) return; // comandos usados en DM (ej. autocomplete raro) no tienen guild
  await bump(guildId, { commands: 1 }).catch((error) => logStatError('commands_executed', guildId, error));
});

eventBus.on('MEMBER_JOINED', async ({ guildId }) => {
  await bump(guildId, { newMembers: 1 }).catch((error) => logStatError('new_members', guildId, error));
});

// QUÉ CAMBIÓ (Fase A, segunda auditoría 2026-08-30): filtra por `origin` — un ajuste de
// staff (`admin`) ya no infla money_created, y una ganancia de casino/caja misteriosa
// (`stake`) suma su ganancia NETA, nunca el payout bruto. Mismo criterio exacto que el
// handler de misiones en missionsStore.js — 'reward' (recompensa de misión) SÍ cuenta
// acá, a diferencia de misiones: pagar una misión es plata nueva real entrando a la
// economía del servidor, y a diferencia del progreso de otra misión, contarla acá no
// puede generar ningún ciclo (esta tabla no vuelve a emitir eventos).
eventBus.on('COINS_EARNED', async ({ guildId, amount, netAmount, origin }) => {
  if (origin === 'admin') return;
  const countedAmount = origin === 'stake' ? netAmount : amount;
  if (!(countedAmount > 0)) return;
  await bump(guildId, { money: countedAmount }).catch((error) => logStatError('money_created', guildId, error));
});

// QUÉ CAMBIÓ (Fase A): nuevo — el único sumidero real instrumentado hoy (crime_fine,
// purchase; ver economyOrigins.js e economyStore.recordTransaction).
eventBus.on('COINS_DESTROYED', async ({ guildId, amount }) => {
  await bump(guildId, { moneyDestroyed: amount }).catch((error) => logStatError('money_destroyed', guildId, error));
});

// QUÉ CAMBIÓ (Fase A): filtra `origin === 'admin'` — XP otorgada a mano por staff
// (/xp agregar) ya no cuenta como actividad del servidor.
eventBus.on('XP_GAINED', async ({ guildId, amount, origin }) => {
  if (origin === 'admin') return;
  await bump(guildId, { xp: amount }).catch((error) => logStatError('xp_distributed', guildId, error));
});
