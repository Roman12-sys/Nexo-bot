import { ActivityType } from 'discord.js';
import { rescheduleActiveGiveaways } from '../utils/giveawayEngine.js';
import { reconcileOnStartup } from '../utils/tempVoiceEngine.js';
import { rescheduleReminders } from '../utils/reminderEngine.js';
import { rescheduleActivePunishments } from '../utils/punishEngine.js';
import { startVoiceXpLoop } from '../utils/voiceXpEngine.js';
import { startLogPurgeLoop } from '../utils/logPurgeEngine.js';
import { startLolPatchLoop } from '../utils/lolPatchEngine.js';
import { startLolDdragonMonitorLoop } from '../utils/lolPatchMonitor.js';
// Import de efecto (no se usa ningún export de acá): registra los handlers del Event
// Engine que llenan guild_daily_stats en vivo — Fase 5. Sin este import nada garantiza
// que el archivo se cargue, a diferencia de achievements.js/missionsStore.js, que ya
// entran transitivamente al importarlos comandos reales.
import '../utils/guildDailyStatsStore.js';

export const name = 'clientReady';
export const once = true;

export async function execute(client) {
  console.log(`Conectado como ${client.user.tag}`);

  // Presencia fija (no rotativa — eso se descartó a propósito, ver CLAUDE.md "Qué se
  // dejó afuera a propósito"). Solo un aviso de "así se usa el bot", nada más.
  client.user.setActivity('/help', { type: ActivityType.Listening });

  // Los setTimeout de scheduleGiveawayEnd se pierden en cada redeploy — hay que
  // volver a programarlos contra lo que ya está guardado en Supabase.
  await rescheduleActiveGiveaways(client).catch((error) => console.error('❌ Error reprogramando sorteos activos:', error));

  // Limpia registros de salas temporales cuyo canal ya no existe, y siembra las
  // estadísticas en vivo de las que sí siguen activas.
  await reconcileOnStartup(client).catch((error) => console.error('❌ Error reconciliando salas de voz temporales:', error));

  // Mismo motivo que los sorteos: los setTimeout de /recordatorio viven solo en
  // memoria, hay que volver a programarlos contra lo guardado en Supabase.
  await rescheduleReminders(client).catch((error) => console.error('❌ Error reprogramando recordatorios:', error));

  // QUÉ CAMBIÓ: se agregó esta línea. MOTIVO: auditoría 2026-08-29 (Parte 22) —
  // /punish con duración ahora persiste en active_punishments; mismo motivo que las
  // otras tres líneas de arriba, el setTimeout se pierde en cada redeploy.
  await rescheduleActivePunishments(client).catch((error) => console.error('❌ Error reprogramando restricciones con duración:', error));

  // Barrido de XP por tiempo en voz — arranca acá y se repite solo cada 5 minutos,
  // no hace falta reprogramar nada al reiniciar (no depende de estado guardado).
  startVoiceXpLoop(client);

  // Purga de logs con más de 5 días — mismo motivo: se repite sola cada 12hs, no
  // depende de estado guardado en ningún lado.
  startLogPurgeLoop(client);

  // Anuncia patch notes nuevos de LoL en un canal fijo — se repite sola cada 20 min,
  // el estado de "último patch anunciado" vive en Supabase (lol_patch_state).
  startLolPatchLoop(client);

  // Señal secundaria de monitoreo (Data Dragon) para detectar si el scraper de arriba
  // se rompió — nunca publica nada, solo deja un warning en consola. No necesita el
  // client porque no manda mensajes a Discord.
  startLolDdragonMonitorLoop();
}
