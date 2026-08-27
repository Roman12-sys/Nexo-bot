// Purga automática de los 3 canales de log (moderación/actividad/economía). No es que
// enviar logs trabe al bot — discord.js encola y reintenta rate limits solo, y el caché
// de mensajes ya viene acotado por defecto — pero sin esto el canal se vuelve una pared
// de miles de mensajes en unos meses, imposible de navegar para el staff. Mismo patrón
// que voiceXpEngine.js: un barrido periódico sobre todos los guilds.
import { PermissionFlagsBits } from 'discord.js';
import { getGuildLogChannel } from './guildLogChannels.js';

const TICK_MS = 12 * 60 * 60 * 1000; // cada 12 horas alcanza de sobra para una retención de días
const RETENTION_MS = 5 * 24 * 60 * 60 * 1000; // 5 días
const LOG_CATEGORIES = ['moderation', 'activity', 'economy'];
const MAX_PAGES_PER_CHANNEL = 20; // circuito de seguridad: tope de ~2000 mensajes revisados por canal y corrida

// Pagina desde el mensaje más reciente hacia atrás y borra lo que sea más viejo que
// RETENTION_MS. bulkDelete exige 2-100 mensajes a la vez (Discord rechaza un array de
// 1) — un mensaje viejo suelto se borra individualmente. El segundo argumento `true`
// de bulkDelete descarta automáticamente cualquier mensaje de más de 14 días (límite
// real de la API) en vez de que falle el lote entero.
async function purgeOldMessages(channel) {
  const cutoff = Date.now() - RETENTION_MS;
  let lastId;
  let totalDeleted = 0;

  for (let page = 0; page < MAX_PAGES_PER_CHANNEL; page++) {
    const messages = await channel.messages.fetch({ limit: 100, ...(lastId ? { before: lastId } : {}) });
    if (messages.size === 0) break;
    lastId = messages.last().id;

    const oldMessages = messages.filter((m) => m.createdTimestamp < cutoff);
    if (oldMessages.size === 1) {
      await oldMessages.first().delete().catch(() => {});
      totalDeleted += 1;
    } else if (oldMessages.size > 1) {
      const deleted = await channel.bulkDelete(oldMessages, true).catch(() => new Map());
      totalDeleted += deleted.size;
    }

    if (messages.size < 100) break; // llegamos al principio del canal, no hay más que revisar
  }

  return totalDeleted;
}

async function purgeTick(client) {
  for (const guild of client.guilds.cache.values()) {
    for (const category of LOG_CATEGORIES) {
      let channel;
      try {
        channel = await getGuildLogChannel(client, guild.id, category);
      } catch (error) {
        console.error(`❌ [purga de logs] Error resolviendo canal de ${category} en ${guild.name}:`, error);
        continue;
      }
      if (!channel) continue;

      // Sin este chequeo, un bot sin "Gestionar mensajes" en el canal de logs fallaba
      // en silencio cada 12hs para siempre (bulkDelete atrapado por el .catch(() => new
      // Map()) de purgeOldMessages) — nadie se enteraba nunca de que la purga no corría.
      if (!channel.permissionsFor(channel.guild.members.me)?.has(PermissionFlagsBits.ManageMessages)) {
        console.warn(`⚠️ [purga de logs] Al bot le falta "Gestionar mensajes" en #${channel.name} (${guild.name}, ${category}) — no se puede purgar.`);
        continue;
      }

      try {
        const deleted = await purgeOldMessages(channel);
        if (deleted > 0) {
          console.log(`🧹 [purga de logs] ${deleted} mensaje(s) borrados en #${channel.name} (${guild.name}, ${category}).`);
        }
      } catch (error) {
        console.error(`❌ [purga de logs] Error purgando #${channel.name} en ${guild.name}:`, error);
      }
    }
  }
}

export function startLogPurgeLoop(client) {
  setInterval(() => {
    purgeTick(client).catch((error) => console.error('❌ [purga de logs] Error en el barrido:', error));
  }, TICK_MS).unref();
}
