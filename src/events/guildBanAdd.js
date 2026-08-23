import { Events, AuditLogEvent, PermissionFlagsBits } from 'discord.js';
import { createBanLogEmbed } from '../utils/logEmbeds.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';

const AUDIT_LOG_WINDOW_MS = 5000;

export const name = Events.GuildBanAdd;
export const once = false;

export async function execute(ban, client) {
  try {
    const logChannel = await getGuildLogChannel(client, ban.guild.id, 'moderation');
    if (!logChannel) return;

    let executor = null;
    let reason = ban.reason || null;

    try {
      const me = ban.guild.members.me;
      if (me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
        const auditLogs = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 5 });
        const entry = auditLogs.entries.find((e) => {
          const isSameTarget = e.target?.id === ban.user.id;
          const isRecent = Date.now() - e.createdTimestamp < AUDIT_LOG_WINDOW_MS;
          return isSameTarget && isRecent;
        });

        // Si lo baneó nuestro propio bot (ej: vía /ban), ya se registró desde el comando: no duplicar.
        if (entry?.executor?.id === client.user.id) return;

        if (entry) {
          executor = entry.executor;
          reason = entry.reason || reason;
        }
      }
    } catch (auditError) {
      console.error('⚠️ No se pudo consultar el registro de auditoría para el baneo:', auditError);
    }

    const embed = createBanLogEmbed({ user: ban.user, executor, reason });
    await logChannel.send({ embeds: [embed] });
  } catch (error) {
    console.error('❌ Error registrando el baneo:', error);
  }
}
