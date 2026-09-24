// Contador de miembros (NEXO Setup Inteligente, Bloque 10) — canal de voz bloqueado
// (nadie se puede conectar) cuyo NOMBRE muestra el conteo, actualizado por un barrido
// periódico. Mismo esqueleto que weeklyDigestEngine.js/voiceXpEngine.js (setInterval +
// guardia contra solapamiento + try/catch por-guild), sin precedente previo de renombrar
// un canal en loop en este proyecto — Discord limita los renames a ~2 cada 10 minutos
// por canal, así que el intervalo (15 min) queda bien por debajo de ese límite incluso en
// el peor caso, y un rename SOLO se dispara si el conteo realmente cambió desde la
// última vez (member_counter_last_count) — nunca un "touch" sin cambios reales.
import { reportCriticalError } from './errorReporter.js';
import { getGuildConfig, setGuildConfig, getGuildsWithMemberCounter } from './guildConfigStore.js';

export const MEMBER_COUNTER_TICK_MS = 15 * 60 * 1000;

let tickRunning = false;

export function buildCounterChannelName(count) {
  return `👥・Miembros: ${count.toLocaleString('es-ES')}`;
}

// Núcleo compartido: recibe el canal y el último conteo ya leídos, así el barrido no
// tiene que pedir la config de cada guild por separado.
async function syncCounterChannel(guild, { channelId, lastCount }) {
  const channel = guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null));
  if (!channel) return { updated: false, missing: true }; // canal borrado a mano — no se recrea solo, ver setupState.js

  const count = guild.memberCount;
  if (lastCount === count) return { updated: false };

  const name = buildCounterChannelName(count);
  if (channel.name === name) {
    await setGuildConfig(guild.id, { member_counter_last_count: count });
    return { updated: false };
  }

  await channel.setName(name, 'Actualización periódica del contador de miembros (NEXO)');
  await setGuildConfig(guild.id, { member_counter_last_count: count });
  return { updated: true };
}

// Un solo guild (lo usa /setup justo después de crear/reusar el canal).
export async function syncMemberCounterForGuild(guild) {
  const cfg = await getGuildConfig(guild.id);
  if (!cfg.member_counter_channel_id) return { updated: false };
  return syncCounterChannel(guild, { channelId: cfg.member_counter_channel_id, lastCount: cfg.member_counter_last_count });
}

// UNA consulta con los guilds que tienen contador, en vez de getGuildConfig por cada guild
// del bot (auditoría 2026-09-23 — ver getGuildsWithMemberCounter). Si esa consulta falla,
// el error sube a startMemberCounterLoop, que lo loguea y manda la alerta operativa.
export async function runMemberCounterSweep(client) {
  const counters = await getGuildsWithMemberCounter();
  for (const counter of counters) {
    const guild = client.guilds.cache.get(counter.guildId);
    if (!guild) continue; // el bot ya no está ahí (guildDelete borra la fila al salir)
    try {
      await syncCounterChannel(guild, counter);
    } catch (error) {
      // Rate limit de Discord u otro error puntual — se reintenta solo en el próximo
      // tick, sin marcar last_count como si el cambio se hubiera aplicado.
      console.error(`⚠️ [contador de miembros] Error en guild ${guild.id}:`, error?.message || error);
    }
  }
}

export function startMemberCounterLoop(client) {
  setInterval(() => {
    if (tickRunning) {
      console.warn('⚠️ [contador de miembros] El barrido anterior todavía no terminó — se saltea este tick.');
      return;
    }
    tickRunning = true;
    runMemberCounterSweep(client)
      .catch((error) => {
        console.error('❌ [contador de miembros] Error en el barrido periódico:', error);
        reportCriticalError(client, 'memberCounterEngine: barrido periódico', error);
      })
      .finally(() => {
        tickRunning = false;
      });
  }, MEMBER_COUNTER_TICK_MS).unref();
}
