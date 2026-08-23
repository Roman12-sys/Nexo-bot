import { Events, AuditLogEvent } from 'discord.js';
import { createUnbanAutoLogEmbed } from '../utils/logEmbeds.js';
import { findExecutor } from '../utils/auditLog.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';

export const name = Events.GuildBanRemove;
export const once = false;

export async function execute(ban, client) {
  try {
    const logChannel = await getGuildLogChannel(client, ban.guild.id, 'moderation');
    if (!logChannel) return;

    const entry = await findExecutor(ban.guild, { type: AuditLogEvent.MemberBanRemove, targetId: ban.user.id });

    // Si lo desbaneó nuestro propio bot (ej: vía un comando /unban), ya se
    // registró desde ese comando: no duplicar.
    if (entry?.executor?.id === client.user.id) return;

    await logChannel.send({
      embeds: [
        createUnbanAutoLogEmbed({ user: ban.user, executor: entry?.executor || null, reason: entry?.reason }),
      ],
    });
  } catch (error) {
    console.error('❌ Error registrando el desbaneo:', error);
  }
}
