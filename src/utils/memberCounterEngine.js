// Contador de miembros (NEXO Setup Inteligente, Bloque 10) — canal de voz bloqueado
// (nadie se puede conectar) cuyo NOMBRE muestra el conteo, actualizado por un barrido
// periódico. Mismo esqueleto que weeklyDigestEngine.js/voiceXpEngine.js (setInterval +
// guardia contra solapamiento + try/catch por-guild), sin precedente previo de renombrar
// un canal en loop en este proyecto — Discord limita los renames a ~2 cada 10 minutos
// por canal, así que el intervalo (15 min) queda bien por debajo de ese límite incluso en
// el peor caso, y un rename SOLO se dispara si el conteo realmente cambió desde la
// última vez (member_counter_last_count) — nunca un "touch" sin cambios reales.
import { reportCriticalError } from './errorReporter.js';
import { getGuildConfig, setGuildConfig } from './guildConfigStore.js';

export const MEMBER_COUNTER_TICK_MS = 15 * 60 * 1000;

let tickRunning = false;

export function buildCounterChannelName(count) {
  return `👥・Miembros: ${count.toLocaleString('es-ES')}`;
}

// Exportada aparte de syncMemberCounterForGuild para que /setup pueda armar el nombre
// inicial exacto al crear el canal, sin duplicar el formato acá y allá.
export async function syncMemberCounterForGuild(guild) {
  const cfg = await getGuildConfig(guild.id);
  if (!cfg.member_counter_channel_id) return { updated: false };

  const channel = guild.channels.cache.get(cfg.member_counter_channel_id) || (await guild.channels.fetch(cfg.member_counter_channel_id).catch(() => null));
  if (!channel) return { updated: false, missing: true }; // canal borrado a mano — no se recrea solo, ver setupState.js

  const count = guild.memberCount;
  if (cfg.member_counter_last_count === count) return { updated: false };

  const name = buildCounterChannelName(count);
  if (channel.name === name) {
    await setGuildConfig(guild.id, { member_counter_last_count: count });
    return { updated: false };
  }

  await channel.setName(name, 'Actualización periódica del contador de miembros (NEXO)');
  await setGuildConfig(guild.id, { member_counter_last_count: count });
  return { updated: true };
}

export async function runMemberCounterSweep(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      await syncMemberCounterForGuild(guild);
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
