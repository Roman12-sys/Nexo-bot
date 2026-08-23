import { Events, AuditLogEvent } from 'discord.js';
import { createThreadLogEmbed } from '../utils/logEmbeds.js';
import { findExecutor } from '../utils/auditLog.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';

export const name = Events.ThreadCreate;
export const once = false;

export async function execute(thread, newlyCreated, client) {
  // discord.js pasa (thread, newlyCreated) — newlyCreated es false cuando el
  // bot simplemente pasa a tener acceso a un hilo ya existente al iniciar.
  if (!newlyCreated) return;
  if (!thread.guild) return;

  try {
    const logChannel = await getGuildLogChannel(client, thread.guild.id, 'activity');
    if (!logChannel) return;

    const entry = await findExecutor(thread.guild, { type: AuditLogEvent.ThreadCreate, targetId: thread.id });

    await logChannel.send({
      embeds: [createThreadLogEmbed({ action: 'create', thread, executor: entry?.executor || null })],
    });
  } catch (error) {
    console.error('❌ Error registrando la creación de un hilo:', error);
  }
}
