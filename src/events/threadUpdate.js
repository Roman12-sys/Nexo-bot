import { Events, AuditLogEvent } from 'discord.js';
import { createThreadLogEmbed } from '../utils/logEmbeds.js';
import { findExecutor } from '../utils/auditLog.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';

export const name = Events.ThreadUpdate;
export const once = false;

export async function execute(oldThread, newThread, client) {
  if (!newThread.guild) return;
  if (oldThread.archived === newThread.archived && oldThread.locked === newThread.locked) return;

  try {
    const logChannel = await getGuildLogChannel(client, newThread.guild.id, 'activity');
    if (!logChannel) return;

    const entry = await findExecutor(newThread.guild, { type: AuditLogEvent.ThreadUpdate, targetId: newThread.id });

    let extra;
    if (oldThread.archived !== newThread.archived) extra = newThread.archived ? 'Archivado' : 'Reabierto';
    else if (oldThread.locked !== newThread.locked) extra = newThread.locked ? 'Bloqueado' : 'Desbloqueado';

    await logChannel.send({
      embeds: [
        createThreadLogEmbed({ action: 'update', thread: newThread, executor: entry?.executor || null, extra }),
      ],
    });
  } catch (error) {
    console.error('❌ Error registrando la actualización de un hilo:', error);
  }
}
