// XP por tiempo en voz — a diferencia del XP por mensaje (grantMessageXp, evento por
// evento), esto es un barrido periódico: cada 5 minutos recorre los canales de voz de
// cada guild y le da XP a quien siga conectado en ese momento. Es más simple que
// trackear join/leave exactos por usuario, a costa de granularidad (si alguien entra y
// sale antes del próximo tick, no suma nada) — trade-off aceptable para esto.
import { getGuildConfig } from './guildConfigStore.js';
import { addXp } from './xpStore.js';
import { processLevelUp } from './xpEngine.js';

const TICK_MS = 5 * 60 * 1000; // 5 minutos
const XP_MIN = 10;
const XP_MAX = 20;
// Requiere al menos 2 humanos en el canal — corta el caso más obvio de alguien
// farmeando XP solo, AFK, en un canal de voz vacío de gente real.
const MIN_HUMANS_IN_CHANNEL = 2;

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

      for (const member of humanMembers) {
        // Ensordecido (por sí mismo o por el server) = no está participando de
        // verdad, no debería sumar lo mismo que alguien activo en la conversación.
        if (member.voice.deaf || member.voice.selfDeaf) continue;

        const amount = Math.floor(Math.random() * (XP_MAX - XP_MIN + 1)) + XP_MIN;
        try {
          const result = await addXp(guild.id, member.id, amount);
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

export function startVoiceXpLoop(client) {
  setInterval(() => {
    grantVoiceXpTick(client).catch((error) => console.error('❌ [XP voz] Error en el barrido de XP por voz:', error));
  }, TICK_MS).unref();
}
