import { Events, AuditLogEvent } from 'discord.js';
import { createKickLogEmbed, createMemberLeftLogEmbed } from '../utils/logEmbeds.js';
import { findExecutor } from '../utils/auditLog.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';

export const name = Events.GuildMemberRemove;
export const once = false;

export async function execute(member, client) {
  try {
    const logChannel = await getGuildLogChannel(client, member.guild.id, 'activity');
    if (!logChannel) return;

    const entry = await findExecutor(member.guild, {
      type: AuditLogEvent.MemberKick,
      targetId: member.id,
    });

    // Si lo kickeó nuestro propio bot (ej: vía /kick), ya se registró desde
    // el comando: no duplicar ni loguear como salida voluntaria.
    if (entry?.executor?.id === client.user.id) return;

    if (entry) {
      await logChannel.send({
        embeds: [createKickLogEmbed({ user: member.user, executor: entry.executor, reason: entry.reason })],
      });
      return;
    }

    await logChannel.send({ embeds: [createMemberLeftLogEmbed({ member })] });
  } catch (error) {
    console.error('❌ Error registrando la salida del miembro:', error);
  }
}
