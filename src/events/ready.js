import { rescheduleActiveGiveaways } from '../utils/giveawayEngine.js';
import { reconcileOnStartup } from '../utils/tempVoiceEngine.js';
import { rescheduleReminders } from '../utils/reminderEngine.js';

export const name = 'clientReady';
export const once = true;

export async function execute(client) {
  console.log(`Conectado como ${client.user.tag}`);

  // Los setTimeout de scheduleGiveawayEnd se pierden en cada redeploy — hay que
  // volver a programarlos contra lo que ya está guardado en Supabase.
  await rescheduleActiveGiveaways(client).catch((error) => console.error('❌ Error reprogramando sorteos activos:', error));

  // Limpia registros de salas temporales cuyo canal ya no existe, y siembra las
  // estadísticas en vivo de las que sí siguen activas.
  await reconcileOnStartup(client).catch((error) => console.error('❌ Error reconciliando salas de voz temporales:', error));

  // Mismo motivo que los sorteos: los setTimeout de /recordatorio viven solo en
  // memoria, hay que volver a programarlos contra lo guardado en Supabase.
  await rescheduleReminders(client).catch((error) => console.error('❌ Error reprogramando recordatorios:', error));
}
