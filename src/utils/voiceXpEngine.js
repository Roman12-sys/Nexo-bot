// XP por tiempo en voz — a diferencia del XP por mensaje (grantMessageXp, evento por
// evento), esto es un barrido periódico: cada 5 minutos recorre los canales de voz de
// cada guild y le da XP a quien siga conectado en ese momento. Es más simple que
// trackear join/leave exactos por usuario, a costa de granularidad (si alguien entra y
// sale antes del próximo tick, no suma nada) — trade-off aceptable para esto.
import { getGuildConfig } from './guildConfigStore.js';
import { addXp, getUserXp, XP_BOOST_MULTIPLIER } from './xpStore.js';
import { processLevelUp, getGuildXpMultiplier } from './xpEngine.js';

const TICK_MS = 5 * 60 * 1000; // 5 minutos
const XP_MIN = 10;
const XP_MAX = 20;
// Requiere al menos 2 humanos en el canal — corta el caso más obvio de alguien
// farmeando XP solo, AFK, en un canal de voz vacío de gente real.
const MIN_HUMANS_IN_CHANNEL = 2;

// Evaluación técnica (Fase 2A, 2026-08-31) — se revisó si discord.js expone alguna señal
// mejor que "2+ humanos, ninguno ensordecido" para detectar actividad REAL en voz (no
// solo presencia) antes de tocar nada acá. Conclusión: no existe una señal confiable sin
// unirse al canal de voz de verdad.
//   - El Gateway de Discord (VoiceState) no expone "quién está hablando ahora mismo" —
//     eso solo viaja como paquetes de audio Opus dentro de la conexión de voz misma
//     (protocolo separado del Gateway normal), y discord.js solo la recibe si el bot ya
//     se unió a ESE canal puntual (@discordjs/voice, VoiceReceiver/AudioReceiveStream).
//   - Unirse a TODOS los canales de voz de un servidor a la vez para escuchar "quién
//     habla" no es viable: un bot solo puede tener una conexión de voz activa por
//     servidor, no una por canal — y hacerlo solo para medir actividad sería invasivo
//     (procesar audio de canales donde nadie pidió que el bot esté) y carísimo en
//     recursos para algo que hoy es un barrido cada 5 minutos sobre potencialmente
//     muchos servidores.
//   - selfMute (a diferencia de selfDeaf) se evaluó y se descartó como filtro extra:
//     mutear el propio micrófono no implica estar inactivo (alguien mirando una
//     pantalla compartida, escuchando sin querer interrumpir, etc.) — a diferencia de
//     estar ensordecido, que sí implica no poder ni siquiera escuchar la conversación.
// Conclusión: "2+ humanos, no ensordecido" queda como el mejor proxy disponible sin
// falsos positivos de "detección de actividad" que en realidad no mide nada real.

async function grantVoiceXpTick(client) {
  for (const guild of client.guilds.cache.values()) {
    let cfg;
    try {
      cfg = await getGuildConfig(guild.id);
    } catch (error) {
      console.error(`❌ [XP voz] Error leyendo config de ${guild.name}:`, error);
      continue;
    }
    if (!cfg.features?.xp) continue;

    for (const channel of guild.channels.cache.values()) {
      if (!channel.isVoiceBased()) continue;
      if (channel.id === guild.afkChannelId) continue;

      const humanMembers = [...channel.members.values()].filter((m) => !m.user.bot);
      if (humanMembers.length < MIN_HUMANS_IN_CHANNEL) continue;

      const externalMultiplier = getGuildXpMultiplier(cfg);

      for (const member of humanMembers) {
        // Ensordecido (por sí mismo o por el server) = no está participando de
        // verdad, no debería sumar lo mismo que alguien activo en la conversación.
        if (member.voice.deaf || member.voice.selfDeaf) continue;

        const base = Math.floor(Math.random() * (XP_MAX - XP_MIN + 1)) + XP_MIN;
        try {
          // Mismo impulso que grantMessageXp (item de tienda type:'xp_boost') — se
          // resuelve acá y no en xpStore.js por el mismo motivo que el multiplicador de
          // finde: requiere leer el registro de XP antes de decidir el monto a sumar.
          const xpRecord = await getUserXp(guild.id, member.id);
          const boostActive = xpRecord.xpBoostUntil > Date.now();
          const amount = Math.floor(base * (boostActive ? XP_BOOST_MULTIPLIER : 1) * externalMultiplier);

          // QUÉ CAMBIÓ: se agregó { source: 'voice' } — mismo criterio que grantMessageXp
          // etiqueta 'message' en xpStore.js. Deja que missionsStore.js distinga XP de
          // voz de XP de mensaje sin que este archivo sepa nada de misiones.
          const result = await addXp(guild.id, member.id, amount, { source: 'voice' });
          if (result.leveledUp) {
            await processLevelUp(
              member,
              { previousLevel: result.previousLevel, newLevel: result.newLevel, totalXp: result.record.xp },
              client,
            ).catch((error) => console.error('❌ [XP voz] Error procesando subida de nivel:', error));
          }
        } catch (error) {
          console.error(`❌ [XP voz] Error otorgando XP a ${member.id} en ${guild.name}:`, error);
        }
      }
    }
  }
}

// Guardia contra ticks solapados — setInterval no espera a que el tick anterior termine
// antes de disparar el siguiente. grantVoiceXpTick recorre TODOS los guilds de forma
// secuencial y, por cada canal con actividad real, hace 2 awaits a Supabase POR
// MIEMBRO (getUserXp + addXp), también en secuencia — con muchos servidores y mucha
// gente en voz a la vez, un barrido puede tardar más que TICK_MS. Sin esta guardia, dos
// barridos corriendo en paralelo podían darle XP doble a quien siguiera conectado en
// ambos, sin ningún lock que lo evite (a diferencia de grantMessageXp, que sí tiene uno
// por usuario). No se paraleliza el barrido en sí: la actividad de voz simultánea real
// (no la cantidad total de guilds) es lo que determina el costo de cada tick, y hoy no
// hay evidencia de que ESO sea el cuello de botella — la guardia resuelve la duplicación
// real sin inventar una reescritura que todavía no hace falta.
// MOTIVO: auditoría Fase 2C, sección 8.
let tickRunning = false;

export function startVoiceXpLoop(client) {
  setInterval(() => {
    if (tickRunning) {
      console.warn('⚠️ [XP voz] El barrido anterior todavía no terminó — se saltea este tick para no duplicar XP.');
      return;
    }
    tickRunning = true;
    grantVoiceXpTick(client)
      .catch((error) => console.error('❌ [XP voz] Error en el barrido de XP por voz:', error))
      .finally(() => {
        tickRunning = false;
      });
  }, TICK_MS).unref();
}
