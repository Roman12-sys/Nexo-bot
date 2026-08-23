import { Events, AuditLogEvent } from 'discord.js';
import { createBanLogEmbed } from '../utils/logEmbeds.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';
import { findExecutor } from '../utils/auditLog.js';

export const name = Events.GuildBanAdd;
export const once = false;

export async function execute(ban, client) {
  try {
    const logChannel = await getGuildLogChannel(client, ban.guild.id, 'moderation');
    if (!logChannel) return;

    const entry = await findExecutor(ban.guild, { type: AuditLogEvent.MemberBanAdd, targetId: ban.user.id });

    // Si lo baneó nuestro propio bot (ej: vía /ban), ya se registró desde el comando: no duplicar.
    if (entry?.executor?.id === client.user.id) return;

    const embed = createBanLogEmbed({ user: ban.user, executor: entry?.executor || null, reason: entry?.reason || ban.reason || null });
    await logChannel.send({ embeds: [embed] });
  } catch (error) {
    console.error('❌ Error registrando el baneo:', error);
  }
}
