// Lado "con acceso a Discord" de los recordatorios — mismo split que
// giveawayEngine.js: manda el DM y limpia el registro. Los setTimeout se pierden en
// cada redeploy de Railway, por eso rescheduleReminders() existe (llamada desde
// ready.js), igual que rescheduleActiveGiveaways().
import { EmbedBuilder } from 'discord.js';
import { getAllReminders, deleteReminder, rescheduleReminder } from './remindersStore.js';
import { BRAND_COLOR, BRAND_NAME } from './embeds.js';

const MAX_DELAY_MS = 2_147_483_647; // límite de setTimeout en Node (~24.8 días) — ver scheduleReminder

// Handle del setTimeout activo por recordatorio — sin esto, /recordatorio cancelar solo
// podía borrar la fila de Supabase, pero el timer en memoria seguía vivo y disparaba el
// DM igual. Se actualiza en cada re-encadenamiento (recordatorios de más de ~24.8 días).
const activeTimeouts = new Map(); // reminderId -> Timeout

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
    activeTimeouts.delete(reminder.id);

    // Recurrente: se reprograma para la próxima vez en vez de borrarse. Se calcula desde
    // Date.now() (no desde el remindAt viejo) a propósito — si el bot estuvo caído y se
    // perdieron varios ciclos, no queremos que se disparen todos juntos al reiniciar.
    if (reminder.repeatMs) {
      const nextRemindAt = Date.now() + reminder.repeatMs;
      try {
        await rescheduleReminder(reminder.id, nextRemindAt);
        scheduleReminder(client, { ...reminder, remindAt: nextRemindAt });
      } catch (error) {
        console.error('❌ Error reprogramando recordatorio recurrente:', error);
      }
    } else {
      await deleteReminder(reminder.id).catch((error) => console.error('❌ Error borrando recordatorio disparado:', error));
    }
  }
}

// setTimeout con un delay mayor al máximo de Node (~24.8 días, un int32) se dispara
// inmediatamente en vez de tirar error — para recordatorios más largos que eso, hay
// que encadenar timeouts intermedios en vez de uno solo.
export function scheduleReminder(client, reminder) {
  const delay = reminder.remindAt - Date.now();

  if (delay <= 0) {
    activeTimeouts.delete(reminder.id);
    fireReminder(client, reminder).catch((error) => console.error('❌ Error disparando recordatorio:', error));
    return;
  }

  if (delay > MAX_DELAY_MS) {
    const handle = setTimeout(() => scheduleReminder(client, reminder), MAX_DELAY_MS).unref();
    activeTimeouts.set(reminder.id, handle);
    return;
  }

  const handle = setTimeout(() => {
    fireReminder(client, reminder).catch((error) => console.error('❌ Error disparando recordatorio:', error));
  }, delay).unref();
  activeTimeouts.set(reminder.id, handle);
}

// Cancela el timer en memoria de un recordatorio, si todavía está programado. Hay que
// llamar esto ANTES o DESPUÉS de borrar la fila en Supabase da igual (son independientes) —
// pero sin esto, borrar la fila no evitaba que el DM se mandara igual.
export function cancelReminder(reminderId) {
  const handle = activeTimeouts.get(reminderId);
  if (handle) {
    clearTimeout(handle);
    activeTimeouts.delete(reminderId);
  }
}

export async function rescheduleReminders(client) {
  const reminders = await getAllReminders();
  for (const reminder of reminders) {
    scheduleReminder(client, reminder);
  }
}
