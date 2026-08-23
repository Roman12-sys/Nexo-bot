// Lado "con acceso a Discord" de los recordatorios — mismo split que
// giveawayEngine.js: manda el DM y limpia el registro. Los setTimeout se pierden en
// cada redeploy de Railway, por eso rescheduleReminders() existe (llamada desde
// ready.js), igual que rescheduleActiveGiveaways().
import { EmbedBuilder } from 'discord.js';
import { getAllReminders, deleteReminder } from './remindersStore.js';
import { BRAND_COLOR, BRAND_NAME } from './embeds.js';

const MAX_DELAY_MS = 2_147_483_647; // límite de setTimeout en Node (~24.8 días) — ver scheduleReminder

async function fireReminder(client, reminder) {
  try {
    const user = await client.users.fetch(reminder.userId).catch(() => null);
    if (user) {
      const embed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle('⏰ Recordatorio')
        .setDescription(reminder.message)
        .setFooter({ text: BRAND_NAME })
        .setTimestamp();
      await user.send({ embeds: [embed] }).catch(() => {});
    }
  } finally {
    await deleteReminder(reminder.id).catch((error) => console.error('❌ Error borrando recordatorio disparado:', error));
  }
}

// setTimeout con un delay mayor al máximo de Node (~24.8 días, un int32) se dispara
// inmediatamente en vez de tirar error — para recordatorios más largos que eso, hay
// que encadenar timeouts intermedios en vez de uno solo.
export function scheduleReminder(client, reminder) {
  const delay = reminder.remindAt - Date.now();

  if (delay <= 0) {
    fireReminder(client, reminder).catch((error) => console.error('❌ Error disparando recordatorio:', error));
    return;
  }

  if (delay > MAX_DELAY_MS) {
    setTimeout(() => scheduleReminder(client, reminder), MAX_DELAY_MS).unref();
    return;
  }

  setTimeout(() => {
    fireReminder(client, reminder).catch((error) => console.error('❌ Error disparando recordatorio:', error));
  }, delay).unref();
}

export async function rescheduleReminders(client) {
  const reminders = await getAllReminders();
  for (const reminder of reminders) {
    scheduleReminder(client, reminder);
  }
}
