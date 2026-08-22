import { rescheduleActiveGiveaways } from '../utils/giveawayEngine.js';

export const name = 'clientReady';
export const once = true;

export async function execute(client) {
  console.log(`Conectado como ${client.user.tag}`);

  // Los setTimeout de scheduleGiveawayEnd se pierden en cada redeploy — hay que
  // volver a programarlos contra lo que ya está guardado en Supabase.
  await rescheduleActiveGiveaways(client).catch((error) => console.error('❌ Error reprogramando sorteos activos:', error));
}
