import { Events, AuditLogEvent } from 'discord.js';
import { createTimeoutLogEmbed, createNicknameChangeLogEmbed, createRoleChangeLogEmbed } from '../utils/logEmbeds.js';
import { findExecutor } from '../utils/auditLog.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';

async function handleTimeoutChange(oldMember, newMember, client) {
  const oldTimeout = oldMember.communicationDisabledUntilTimestamp;
  const newTimeout = newMember.communicationDisabledUntilTimestamp;

  const wasTimedOut = Boolean(oldTimeout && oldTimeout > Date.now());
  const isTimedOut = Boolean(newTimeout && newTimeout > Date.now());

  if (wasTimedOut === isTimedOut && oldTimeout === newTimeout) return;
  if (!wasTimedOut && !isTimedOut) return;

  const logChannel = await getGuildLogChannel(client, newMember.guild.id, 'activity');
  if (!logChannel) return;

  const entry = await findExecutor(newMember.guild, {
    type: AuditLogEvent.MemberUpdate,
    targetId: newMember.id,
    filter: (e) => e.changes?.some((c) => c.key === 'communication_disabled_until'),
  });

  // /timeout ya logueó esta acción con el moderador y el motivo reales — sin este
  // guard (que sí tienen todos los eventos hermanos: channelUpdate, guildBanAdd,
  // guildBanRemove, guildMemberRemove, messageBulkDelete), este evento la vuelve a
  // loguear en el canal de actividad con el ejecutor mal atribuido ("Nexo Bot").
  if (entry?.executor?.id === client.user.id) return;

  const embed = createTimeoutLogEmbed({
    user: newMember.user,
    executor: entry?.executor || null,
    reason: entry?.reason || null,
    until: isTimedOut ? newTimeout : null,
    removed: !isTimedOut,
  });

  await logChannel.send({ embeds: [embed] });
}

async function handleNicknameChange(oldMember, newMember, client) {
  if (oldMember.nickname === newMember.nickname) return;

  const logChannel = await getGuildLogChannel(client, newMember.guild.id, 'activity');
  if (!logChannel) return;

  const entry = await findExecutor(newMember.guild, {
    type: AuditLogEvent.MemberUpdate,
    targetId: newMember.id,
    filter: (e) => e.changes?.some((c) => c.key === 'nick'),
  });

  // Mismo guard que handleTimeoutChange/handleRoleChange en este mismo archivo —
  // ningún comando setea nicknames todavía, pero si alguno lo hace en el futuro, ya
  // queda cubierto en vez de duplicarse acá con el ejecutor mal atribuido.
  if (entry?.executor?.id === client.user.id) return;

  const embed = createNicknameChangeLogEmbed({
    member: newMember,
    executor: entry?.executor || null,
    oldNick: oldMember.nickname,
    newNick: newMember.nickname,
  });

  await logChannel.send({ embeds: [embed] });
}

async function handleRoleChange(oldMember, newMember, client) {
  const added = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id));
  const removed = oldMember.roles.cache.filter((r) => !newMember.roles.cache.has(r.id));
  if (added.size === 0 && removed.size === 0) return;

  const logChannel = await getGuildLogChannel(client, newMember.guild.id, 'activity');
  if (!logChannel) return;

  const entry = await findExecutor(newMember.guild, {
    type: AuditLogEvent.MemberRoleUpdate,
    targetId: newMember.id,
  });

  // Mismo motivo que en handleTimeoutChange: /punish, /unpunish y las asignaciones
  // automáticas de rol por nivel ya loguean sus propios cambios de rol — no duplicar.
  if (entry?.executor?.id === client.user.id) return;

  const embed = createRoleChangeLogEmbed({
    member: newMember,
    executor: entry?.executor || null,
    added: [...added.values()],
    removed: [...removed.values()],
  });

  await logChannel.send({ embeds: [embed] });
}

export const name = Events.GuildMemberUpdate;
export const once = false;

export async function execute(oldMember, newMember, client) {
  await Promise.all([
    handleTimeoutChange(oldMember, newMember, client).catch((error) =>
      console.error('❌ Error registrando cambio de timeout:', error),
    ),
    handleNicknameChange(oldMember, newMember, client).catch((error) =>
      console.error('❌ Error registrando cambio de nickname:', error),
    ),
    handleRoleChange(oldMember, newMember, client).catch((error) =>
      console.error('❌ Error registrando cambio de roles:', error),
    ),
  ]);
}
