import { getActiveGiveaways, getGiveaway, updateGiveaway, getGiveawaysPendingAnnouncement } from './giveawaysStore.js';
import { createGiveawayEmbed } from './embeds.js';
import { withLock } from './asyncLock.js';
import { eventBus } from './eventBus.js'; // Event Engine — auditoría 2026-08-29, Parte 7
import { reportCriticalError } from './errorReporter.js';

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

function lockKey(guildId, messageId) {
  return `giveaway:${guildId}:${messageId}`;
}

// Edita el mensaje original a "finalizado" y manda el anuncio de ganadores — el paso
// que puede fallar entre persistir ganadores y avisar de verdad (crash, canal borrado,
// rate limit). Devuelve true solo si el anuncio se mandó con confianza razonable de que
// llegó, así el caller sabe si le corresponde marcar winners_announced_at o dejarlo en
// null para que reconcilePendingGiveawayAnnouncements lo reintente después.
async function announceGiveawayResult(client, guildId, messageId, giveaway) {
  const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
  if (!channel) {
    // Canal borrado: no hay forma de recuperar esto reintentando — se loguea y se
    // marca como "resuelto" para no quedar reintentando para siempre en cada restart.
    console.warn(`⚠️ [sorteos] No se pudo anunciar el sorteo ${messageId}: el canal ya no existe.`);
    return true;
  }

  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (message) {
    const embed = createGiveawayEmbed({ ...giveaway, ended: true });
    await message.edit({ embeds: [embed], components: [] }).catch(() => {});
  }

  try {
    if (giveaway.winners.length > 0) {
      await channel.send({ content: `🎉 ¡Felicidades ${giveaway.winners.map((id) => `<@${id}>`).join(', ')}! Ganaste **${giveaway.prize}**` });
      for (const winnerId of giveaway.winners) {
        await eventBus.emit('ACHIEVEMENT_CHECK', { guildId, userId: winnerId, achievementId: 'con_suerte' });
      }
    } else {
      await channel.send({ content: `😢 Nadie participó en el sorteo de **${giveaway.prize}**, no hubo ganadores.` });
    }
    return true;
  } catch (error) {
    console.error(`❌ [sorteos] Error mandando el anuncio del sorteo ${messageId}, se reintentará al reiniciar:`, error);
    return false;
  }
}

// Termina un sorteo: elige ganadores (si todavía no se habían elegido), persiste el
// estado y anuncia el resultado. Todo el cuerpo va dentro de un lock por sorteo,
// compartido con toggleParticipant y rerollGiveaway: sin esto, /sorteo terminar
// corriendo justo cuando el setTimeout de scheduleGiveawayEnd también dispara puede
// hacer que los dos lean el mismo estado antes de que cualquiera escriba, eligiendo
// ganadores (posiblemente distintos) y anunciando dos veces.
//
// Estado persistido en 2 pasos, no 1 (ver winners_announced_at en schema.sql):
//   1) ended=true + winners — "ya se sabe quién ganó".
//   2) winners_announced_at=Date.now() — "ya se avisó". Solo se escribe si el anuncio
//      salió bien.
// Si el proceso muere entre 1 y 2, el sorteo queda ended=true con winners_announced_at
// null — reconcilePendingGiveawayAnnouncements() lo detecta al reiniciar y llama esta
// misma función, que ve ended=true y salta directo a anunciar sin volver a elegir
// ganadores (nunca se recalculan una vez persistidos).
export async function endGiveaway(client, guildId, messageId) {
  return withLock(lockKey(guildId, messageId), async () => {
    let giveaway = await getGiveaway(guildId, messageId);
    if (!giveaway) return null;
    if (giveaway.cancelled) return null; // cancelGiveaway ganó la carrera — nada que anunciar
    if (giveaway.ended && giveaway.winnersAnnouncedAt) return null; // ya anunciado, no repetir

    if (!giveaway.ended) {
      const winners = pickWinners(giveaway.participants, giveaway.winnersCount);
      giveaway = await updateGiveaway(guildId, messageId, { ended: true, winners, winnersAnnouncedAt: null });
    }

    const announced = await announceGiveawayResult(client, guildId, messageId, giveaway);
    if (announced) {
      giveaway = await updateGiveaway(guildId, messageId, { winnersAnnouncedAt: Date.now() });
    }

    return giveaway;
  });
}

// /sorteo reroll: elige nuevos ganadores de un sorteo YA finalizado. Comparte el mismo
// lock que endGiveaway/toggleParticipant (Diagnóstico Fase 2A) — sin esto, dos reroll
// simultáneos (o un reroll corriendo justo cuando el setTimeout original todavía no
// terminó de anunciar) podían leer el mismo estado viejo y escribir/anunciar resultados
// contradictorios. Excluye del pool a quienes YA habían ganado (si hay de dónde elegir
// otra persona) para que "reroll" signifique de verdad "otro ganador", no una lotería
// que puede repetir al mismo por casualidad.
export async function rerollGiveaway(client, guildId, messageId) {
  return withLock(lockKey(guildId, messageId), async () => {
    const giveaway = await getGiveaway(guildId, messageId);
    if (!giveaway) return { error: 'not_found' };
    if (!giveaway.ended) return { error: 'not_ended' };
    if (giveaway.cancelled) return { error: 'cancelled' };
    if (giveaway.participants.length === 0) return { error: 'no_participants' };

    const freshPool = giveaway.participants.filter((id) => !giveaway.winners.includes(id));
    const candidates = freshPool.length > 0 ? freshPool : giveaway.participants;
    const newWinners = pickWinners(candidates, giveaway.winnersCount);

    const updated = await updateGiveaway(guildId, messageId, { winners: newWinners });

    const channel = await client.channels.fetch(updated.channelId).catch(() => null);
    if (channel) {
      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (message) {
        const embed = createGiveawayEmbed({ ...updated, ended: true });
        await message.edit({ embeds: [embed] }).catch(() => {});
      }
      await channel
        .send({ content: `🔁 Reroll del sorteo de **${updated.prize}**: ¡Felicidades ${newWinners.map((id) => `<@${id}>`).join(', ')}!` })
        .catch(() => {});
    }

    return { giveaway: updated };
  });
}

// /sorteo cancelar: mismo lock que endGiveaway/rerollGiveaway/toggleParticipant (Fase
// 2A) — sin esto, cancelar corriendo justo cuando el setTimeout de scheduleGiveawayEnd
// también dispara podía terminar en cualquiera de las dos transiciones pisando a la
// otra (cancelado con ganadores ya anunciados, o "finalizado" sin quedar marcado
// cancelled). Bajo el lock, el que llegue segundo ve el estado que dejó el primero y se
// frena en el chequeo de "ended", en vez de pisarlo.
export async function cancelGiveaway(client, guildId, messageId) {
  return withLock(lockKey(guildId, messageId), async () => {
    const giveaway = await getGiveaway(guildId, messageId);
    if (!giveaway) return { error: 'not_found' };
    if (giveaway.ended) return { error: 'already_ended' };

    const updated = await updateGiveaway(guildId, messageId, { ended: true, cancelled: true });

    const channel = await client.channels.fetch(updated.channelId).catch(() => null);
    if (channel) {
      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (message) {
        const embed = createGiveawayEmbed({ ...updated, ended: true, cancelled: true });
        await message.edit({ embeds: [embed], components: [] }).catch(() => {});
      }
    }

    return { giveaway: updated };
  });
}

// Programa que, después de "delayMs" milisegundos, el sorteo termine solo.
// .unref() (mismo criterio que reminderEngine.js): un timer de hasta una semana no debe
// mantener vivo el proceso si Node ya no tiene nada más que hacer (ej. durante un
// shutdown limpio de Railway).
export function scheduleGiveawayEnd(client, guildId, messageId, delayMs) {
  setTimeout(async () => {
    // Sin pre-chequeo de "¿ya terminó?" antes de llamar: endGiveaway es idempotente
    // bajo lock (ve ended+winnersAnnouncedAt y no hace nada), así que un pre-chequeo acá
    // solo ahorraría una llamada, nunca evitaría un bug — se saca para no duplicar la
    // misma lógica de estado en dos lugares.
    await endGiveaway(client, guildId, messageId).catch((error) => console.error('❌ [sorteos] Error finalizando sorteo programado:', error));
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

// Se ejecuta UNA vez, al arrancar (junto con rescheduleActiveGiveaways, no en su
// reemplazo): cierra la ventana de crash de Caso B — sorteos donde los ganadores ya se
// calcularon y persistieron (ended=true) pero el proceso murió antes de mandar el
// anuncio. rescheduleActiveGiveaways NUNCA los encuentra (filtra ended=false), por eso
// hace falta esta segunda pasada separada.
//
// Reusa endGiveaway tal cual, sin duplicar su lógica: como el giveaway ya está
// ended=true, endGiveaway entra directo a la rama "saltar el cálculo de ganadores y
// reintentar el anuncio" (ver el comentario de arriba) — nunca vuelve a llamar
// pickWinners. El lock por sorteo (giveaway:{guildId}:{messageId}) es el mismo en los
// dos casos, así que dos reconciliaciones que se solaparan (ej. el barrido periódico de
// abajo pisando al de arranque) se serializan solas sin necesitar un mecanismo aparte.
export async function reconcilePendingGiveawayAnnouncements(client) {
  const pending = await getGiveawaysPendingAnnouncement();

  for (const { guildId, messageId } of pending) {
    await endGiveaway(client, guildId, messageId).catch((error) =>
      console.error('❌ [sorteos] Error reconciliando anuncio pendiente de sorteo:', error),
    );
  }
}

// Retry periódico (Fase 2A.1, 2026-08-31) — reconcilePendingGiveawayAnnouncements ya
// cerraba el crash-window real (Caso B), pero SOLO corría al arrancar. Si channel.send()
// falla por algo transitorio (rate limit, timeout, blip de red de Discord) mientras el
// proceso sigue corriendo normalmente — no un crash — el sorteo quedaba "pendiente de
// anuncio" sin ningún mecanismo que lo reintentara hasta el próximo restart, que en un
// proceso de producción de larga vida puede ser indefinido. Este loop cierra esa ventana.
//
// 5 minutos, mismo intervalo que startVoiceXpLoop (voiceXpEngine.js) — ya establecido en
// el proyecto como el tick "liviano" de referencia. getGiveawaysPendingAnnouncement()
// filtra en Postgres contra un índice parcial armado exactamente para esto
// (giveaways_pending_announcement_idx, ver schema.sql) — en el caso normal (nada
// pendiente) es una consulta sobre un índice vacío, no un escaneo de la tabla completa de
// historial. Un intervalo más corto no compra nada real (el costo de esperar unos
// minutos de más por un anuncio es bajo — nadie pierde el sorteo, lo ve un poco tarde) y
// sí suma tráfico innecesario a Supabase.
const RECONCILE_TICK_MS = 5 * 60 * 1000;
let reconcileLoopStarted = false;

export function startGiveawayReconcileLoop(client) {
  // Guardia contra doble registro: ready.js hoy solo corre una vez por proceso
  // (Events.ClientReady con once=true), así que esto nunca debería dispararse en
  // producción — pero es gratis blindarlo contra un futuro reload/reinicialización que
  // llame startGiveawayReconcileLoop() dos veces sin haber matado el proceso.
  if (reconcileLoopStarted) return;
  reconcileLoopStarted = true;

  // .unref() (mismo criterio que el resto de los loops del proyecto — voiceXpEngine.js,
  // logPurgeEngine.js): no debe mantener vivo el proceso por sí solo. El shutdown limpio
  // (registerShutdown, src/utils/shutdown.js) termina el proceso con process.exit(), que
  // mata este timer junto con todo lo demás sin necesitar un clearInterval explícito —
  // ningún otro loop del proyecto lo hace tampoco.
  setInterval(() => {
    reconcilePendingGiveawayAnnouncements(client).catch((error) => {
      console.error('❌ [sorteos] Error en el barrido periódico de anuncios pendientes:', error);
      reportCriticalError(client, 'giveawayEngine: barrido periódico de anuncios pendientes', error);
    });
  }, RECONCILE_TICK_MS).unref();
}
