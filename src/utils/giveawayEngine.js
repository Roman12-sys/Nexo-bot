import { getActiveGiveaways, getGiveaway, updateGiveaway } from './giveawaysStore.js';
import { createGiveawayEmbed } from './embeds.js';
import { withLock } from './asyncLock.js';
import { eventBus } from './eventBus.js'; // Event Engine — auditoría 2026-08-29, Parte 7

// Elige "count" ganadores al azar de la lista de participantes, sin repetir a nadie
export function pickWinners(participants, count) {
  const pool = [...participants];
  const winners = [];
  const total = Math.min(count, pool.length);

  for (let i = 0; i < total; i++) {
    const index = Math.floor(Math.random() * pool.length);
    winners.push(pool.splice(index, 1)[0]);
  }

  return winners;
}

// Termina un sorteo: elige ganadores, edita el mensaje original y anuncia el resultado.
// Todo el cuerpo va dentro de un lock por sorteo: sin esto, /sorteo terminar corriendo
// justo cuando el setTimeout de scheduleGiveawayEnd también dispara puede hacer que los
// dos lean giveaway.ended:false antes de que cualquiera lo escriba, eligiendo ganadores
// (posiblemente distintos) y anunciando dos veces.
export async function endGiveaway(client, guildId, messageId) {
  return withLock(`giveaway:${guildId}:${messageId}`, async () => {
    const giveaway = await getGiveaway(guildId, messageId);
    if (!giveaway || giveaway.ended) return null;

    const winners = pickWinners(giveaway.participants, giveaway.winnersCount);
    const updated = await updateGiveaway(guildId, messageId, { ended: true, winners });

    const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
    if (!channel) return updated;

    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (message) {
      const embed = createGiveawayEmbed({ ...updated, ended: true });
      await message.edit({ embeds: [embed], components: [] }).catch(() => {});
    }

    if (winners.length > 0) {
      await channel
        .send({ content: `🎉 ¡Felicidades ${winners.map((id) => `<@${id}>`).join(', ')}! Ganaste **${giveaway.prize}**` })
        .catch(() => {});
      for (const winnerId of winners) {
        await eventBus.emit('ACHIEVEMENT_CHECK', { guildId, userId: winnerId, achievementId: 'con_suerte' });
      }
    } else {
      await channel.send({ content: `😢 Nadie participó en el sorteo de **${giveaway.prize}**, no hubo ganadores.` }).catch(() => {});
    }

    return updated;
  });
}

// Programa que, después de "delayMs" milisegundos, el sorteo termine solo.
// .unref() (mismo criterio que reminderEngine.js): un timer de hasta una semana no debe
// mantener vivo el proceso si Node ya no tiene nada más que hacer (ej. durante un
// shutdown limpio de Railway).
export function scheduleGiveawayEnd(client, guildId, messageId, delayMs) {
  setTimeout(async () => {
    const giveaway = await getGiveaway(guildId, messageId);
    if (!giveaway || giveaway.ended) return;
    await endGiveaway(client, guildId, messageId);
  }, delayMs).unref();
}

// Se ejecuta UNA vez, cuando el bot arranca: revisa todos los sorteos guardados (de
// TODOS los servidores) y vuelve a programar el temporizador de los que todavía estaban
// activos. Necesario porque un redeploy/reinicio pierde cualquier setTimeout en memoria.
export async function rescheduleActiveGiveaways(client) {
  const active = await getActiveGiveaways();

  for (const { guildId, messageId, endTimestamp } of active) {
    const remaining = endTimestamp - Date.now();

    if (remaining <= 0) {
      await endGiveaway(client, guildId, messageId);
    } else {
      scheduleGiveawayEnd(client, guildId, messageId, remaining);
    }
  }
}
