import { Events, AuditLogEvent } from 'discord.js';
import { createInviteLogEmbed } from '../utils/logEmbeds.js';
import { findExecutor } from '../utils/auditLog.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';

export const name = Events.InviteDelete;
export const once = false;

export async function execute(invite, client) {
  if (!invite.guild) return;

  try {
    const logChannel = await getGuildLogChannel(client, invite.guild.id, 'activity');
    if (!logChannel) return;

    // El audit log no siempre expone el código de la invite como target
    // confiable; si está, filtramos por él, si no, nos quedamos con la
    // entrada más reciente dentro de la ventana.
    const entry = await findExecutor(invite.guild, {
      type: AuditLogEvent.InviteDelete,
      filter: (e) => !invite.code || !e.target?.code || e.target.code === invite.code,
    });

    await logChannel.send({
      embeds: [createInviteLogEmbed({ action: 'delete', invite, executor: entry?.executor || null })],
    });
  } catch (error) {
    console.error('❌ Error registrando la eliminación de una invite:', error);
  }
}
