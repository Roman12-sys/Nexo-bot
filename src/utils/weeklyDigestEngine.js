// Digest semanal (Ciclo 2, Bloque 11) — resumen de actividad de los últimos 7 días,
// opt-in por servidor (/config digest-semanal), posteado al canal de logs de
// actividad. Mismo criterio de "barrido periódico sobre guild_config" que
// lolPatchEngine.js — nunca un scheduler nuevo ni un cron externo: un setInterval que,
// por cada guild opt-in, chequea si ya pasó una semana desde el último envío
// (guild_config.weekly_digest_last_sent_at, epoch ms — mismo criterio que las columnas
// de cooldown, ver CLAUDE.md).
//
// Restart-resistente sin reprogramar nada: a diferencia de sorteos/recordatorios/
// restricciones (setTimeout puntuales que hay que reconstruir al arrancar), esto es un
// barrido — el próximo tick, sea cuando sea, vuelve a leer weekly_digest_last_sent_at
// de Supabase y decide solo si corresponde mandar. Un restart no puede perder un envío
// pendiente ni duplicar uno ya hecho.
//
// No duplica: last_sent_at solo avanza DESPUÉS de un send exitoso — si el canal de
// logs de actividad no está configurado (o el envío falla), ese guild se saltea el
// tick y se reintenta en el próximo, sin adelantar el reloj. Cada guild se procesa de
// forma aislada (un error en uno nunca frena a los demás — mismo patrón for-of con
// catch por iteración que lolPatchEngine.js; volumen bajo, no amerita Promise.allSettled).
import { EmbedBuilder } from 'discord.js';
import { getGuildsWithWeeklyDigestEnabled, setGuildConfig } from './guildConfigStore.js';
import { getGuildDailyStats } from './guildDailyStatsStore.js';
import { getGuildLogChannel } from './guildLogChannels.js';
import { BRAND_COLOR, BRAND_NAME } from './embeds.js';
import { reportCriticalError } from './errorReporter.js';

const TICK_MS = 60 * 60 * 1000; // 1 hora — la precisión de "semanal" no necesita más
const DIGEST_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

export function sumWeeklyStats(days) {
  return days.reduce(
    (acc, day) => ({
      messagesSent: acc.messagesSent + day.messagesSent,
      commandsExecuted: acc.commandsExecuted + day.commandsExecuted,
      newMembers: acc.newMembers + day.newMembers,
      moneyCreated: acc.moneyCreated + day.moneyCreated,
      moneyDestroyed: acc.moneyDestroyed + day.moneyDestroyed,
      xpDistributed: acc.xpDistributed + day.xpDistributed,
    }),
    { messagesSent: 0, commandsExecuted: 0, newMembers: 0, moneyCreated: 0, moneyDestroyed: 0, xpDistributed: 0 },
  );
}

export function buildDigestEmbed(totals) {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('📊 Resumen semanal')
    .setDescription('Actividad de los últimos 7 días en este servidor.')
    .addFields(
      { name: '💬 Mensajes', value: `${totals.messagesSent}`, inline: true },
      { name: '🤖 Comandos usados', value: `${totals.commandsExecuted}`, inline: true },
      { name: '👋 Miembros nuevos', value: `${totals.newMembers}`, inline: true },
      { name: '🪙 Coins generadas', value: `${totals.moneyCreated}`, inline: true },
      { name: '🔥 Coins destruidas', value: `${totals.moneyDestroyed}`, inline: true },
      { name: '✨ XP repartido', value: `${totals.xpDistributed}`, inline: true },
    )
    .setFooter({ text: `${BRAND_NAME} • Digest semanal` })
    .setTimestamp();
}

async function sendDigestForGuild(client, guildId) {
  const channel = await getGuildLogChannel(client, guildId, 'activity');
  if (!channel) {
    console.warn(`⚠️ [digest semanal] Guild ${guildId} tiene el digest activado pero no tiene canal de logs de actividad configurado — se saltea este tick.`);
    return;
  }

  const days = await getGuildDailyStats(guildId, 7);
  const embed = buildDigestEmbed(sumWeeklyStats(days));

  await channel.send({ embeds: [embed] });
  // Recién acá avanza el reloj — si channel.send() tira (rate limit, permisos), el
  // catch de runDigestSweep lo deja intentar de nuevo en el próximo tick, nunca marca
  // como "enviado" algo que no llegó.
  await setGuildConfig(guildId, { weekly_digest_last_sent_at: Date.now() });
}

export async function runDigestSweep(client) {
  const guilds = await getGuildsWithWeeklyDigestEnabled();
  const now = Date.now();

  for (const { guildId, lastSentAt } of guilds) {
    // lastSentAt siempre se siembra al activar (/config digest-semanal) — null acá solo
    // pasaría si algo escribió la columna por fuera de ese camino. Se trata igual que
    // "recién activado": siembra sin mandar nada, mismo criterio que la primera corrida
    // de lolPatchEngine (nunca mandar un resumen calculado sobre una ventana de tiempo
    // que no se sabe si es válida).
    if (lastSentAt == null) {
      await setGuildConfig(guildId, { weekly_digest_last_sent_at: now }).catch((error) =>
        console.error(`❌ [digest semanal] Error sembrando la fecha inicial para ${guildId}:`, error),
      );
      continue;
    }

    if (now - lastSentAt < DIGEST_PERIOD_MS) continue;

    await sendDigestForGuild(client, guildId).catch((error) => console.error(`❌ [digest semanal] Error mandando el digest de ${guildId}:`, error));
  }
}

// Guardia contra ticks solapados — mismo motivo que voiceXpEngine.js: el barrido
// recorre guilds en secuencia con awaits reales a Supabase/Discord por cada uno; con
// muchos servidores opt-in un tick podría, en teoría, tardar más que TICK_MS.
let tickRunning = false;

export function startWeeklyDigestLoop(client) {
  setInterval(() => {
    if (tickRunning) {
      console.warn('⚠️ [digest semanal] El barrido anterior todavía no terminó — se saltea este tick.');
      return;
    }
    tickRunning = true;
    runDigestSweep(client)
      .catch((error) => {
        console.error('❌ [digest semanal] Error en el barrido semanal:', error);
        reportCriticalError(client, 'weeklyDigestEngine: barrido periódico', error);
      })
      .finally(() => {
        tickRunning = false;
      });
  }, TICK_MS).unref();
}
