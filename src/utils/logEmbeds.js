import { EmbedBuilder } from 'discord.js';
import { BRAND_NAME, LOG_COLOR } from './embeds.js';

const OK_COLOR = '#2A9D8F';
const NEUTRAL_COLOR = '#8D99AE';
const WARN_COLOR = '#E9C46A';

const userTag = (user) => (user ? `${user.tag} (\`${user.id}\`)` : 'Desconocido');
const executorText = (executor) => (executor ? userTag(executor) : 'No se pudo determinar con certeza');

function baseLogEmbed({ color = NEUTRAL_COLOR, title, description, fields = [], footer = 'Logs de moderación' }) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setFooter({ text: `${BRAND_NAME} • ${footer}` })
    .setTimestamp();

  if (description) embed.setDescription(description);
  if (fields.length > 0) embed.addFields(fields);

  return embed;
}

// ---- Mensajes (borrado / edición) ----

function toDiffBlock(lines) {
  const MAX_LEN = 950; // deja margen para el resto del embed dentro del límite de 1024 por campo
  let text = lines.join('\n');
  if (text.length > MAX_LEN) text = `${text.slice(0, MAX_LEN)}...`;
  return `\`\`\`diff\n${text}\n\`\`\``;
}

function diffLines(content, marker) {
  return content.split('\n').map((line) => `${marker}${line}`);
}

export function createMessageDeleteLogEmbed({ message, executor, attachmentResults }) {
  const author = message.author
    ? userTag(message.author)
    : 'Desconocido (`mensaje no disponible en caché`)';
  const channelText = message.channel ? `<#${message.channel.id}>` : 'Desconocido';

  const embed = baseLogEmbed({
    color: LOG_COLOR,
    title: '🗑️ Mensaje eliminado',
    description: `👤 ${author}  ·  📍 ${channelText}  ·  🛡️ ${executorText(executor)}`,
  });

  let contentText = 'No disponible (el mensaje no estaba almacenado en caché)';
  if (!message.partial && typeof message.content === 'string') {
    contentText =
      message.content.length > 0
        ? toDiffBlock(diffLines(message.content, '- '))
        : 'Sin contenido de texto (posible embed/adjunto)';
  }
  embed.addFields({ name: 'Contenido eliminado', value: contentText });

  if (attachmentResults?.length > 0) {
    const failed = attachmentResults.filter((a) => !a.reuploaded);
    if (failed.length > 0) {
      const list = failed.map((a) => `[${a.name}](${a.url}) — ${a.reason}`).join('\n');
      embed.addFields({ name: '⚠️ Adjuntos no recuperados', value: list.slice(0, 1024) });
    }
  }

  return embed;
}

export function createMessageEditLogEmbed({ oldMessage, newMessage, channel }) {
  const author = newMessage.author ? userTag(newMessage.author) : 'Desconocido';
  const channelText = channel ? `<#${channel.id}>` : 'Desconocido';

  const oldContent = typeof oldMessage.content === 'string' && oldMessage.content.length > 0
    ? oldMessage.content
    : '(sin contenido en caché)';
  const newContent = newMessage.content.length > 0 ? newMessage.content : '(sin contenido de texto)';

  const diff = toDiffBlock([...diffLines(oldContent, '- '), ...diffLines(newContent, '+ ')]);

  return baseLogEmbed({
    color: WARN_COLOR,
    title: '📝 Mensaje editado',
    description: `👤 ${author}  ·  📍 ${channelText}`,
    fields: [
      { name: 'Cambios', value: diff },
      { name: 'Ir al mensaje', value: `[Saltar al mensaje](${newMessage.url})` },
    ],
  });
}

// ---- Lock / punish ----

export function createLockLogEmbed({ channel, executor, locked }) {
  return baseLogEmbed({
    color: locked ? LOG_COLOR : OK_COLOR,
    title: locked ? '🔒 Canal bloqueado' : '🔓 Canal desbloqueado',
    fields: [
      { name: 'Canal', value: `<#${channel.id}>`, inline: true },
      { name: locked ? 'Bloqueado por' : 'Desbloqueado por', value: userTag(executor), inline: true },
    ],
  });
}

export function createPunishLogEmbed({ user, executor, reason, applied }) {
  return baseLogEmbed({
    color: applied ? LOG_COLOR : OK_COLOR,
    title: applied ? '🚫 Restricción de imágenes/enlaces aplicada' : '✅ Restricción de imágenes/enlaces removida',
    fields: [
      { name: 'Usuario', value: userTag(user), inline: true },
      { name: applied ? 'Aplicada por' : 'Removida por', value: userTag(executor), inline: true },
      { name: 'Motivo', value: reason || 'Sin motivo especificado' },
    ],
  });
}

export function createPunishFilterLogEmbed({ user, channel, reason }) {
  return baseLogEmbed({
    color: LOG_COLOR,
    title: '🛑 Mensaje bloqueado (usuario sancionado)',
    fields: [
      { name: 'Usuario', value: userTag(user), inline: true },
      { name: 'Canal', value: `<#${channel.id}>`, inline: true },
      { name: 'Motivo del bloqueo', value: reason },
    ],
  });
}

export function createSecretLeakLogEmbed({ user, channel, type, preview }) {
  return baseLogEmbed({
    color: LOG_COLOR,
    title: '🔑 Mensaje borrado: posible secreto expuesto',
    description: 'El mensaje se borró automáticamente. Si el secreto es real, hay que revocarlo/rotarlo YA.',
    fields: [
      { name: 'Usuario', value: userTag(user), inline: true },
      { name: 'Canal', value: `${channel}`, inline: true },
      { name: 'Tipo detectado', value: type, inline: true },
      { name: 'Vista previa (redactada)', value: `\`${preview}\`` },
    ],
  });
}

// ---- Economía (staff / abuso) ----

export function createEconomyAdminLogEmbed({ type, targetUser, executor, amount, balanceBefore, balanceAfter, reason }) {
  const titles = {
    admin_add: '➕ Staff agregó monedas',
    admin_remove: '➖ Staff quitó monedas',
    admin_set: '🛠️ Staff estableció el balance',
  };

  return baseLogEmbed({
    color: WARN_COLOR,
    title: titles[type] || '💰 Movimiento de economía (staff)',
    footer: 'Economía',
    fields: [
      { name: 'Usuario', value: userTag(targetUser), inline: true },
      { name: 'Staff', value: userTag(executor), inline: true },
      { name: 'Monto', value: `${amount >= 0 ? '+' : ''}${amount.toLocaleString('es-ES')}`, inline: true },
      { name: 'Balance anterior', value: `${balanceBefore.toLocaleString('es-ES')}`, inline: true },
      { name: 'Balance nuevo', value: `${balanceAfter.toLocaleString('es-ES')}`, inline: true },
      { name: 'Motivo', value: reason || 'Sin motivo especificado' },
    ],
  });
}

export function createXpAdminLogEmbed({ type, targetUser, executor, amount, xpBefore, xpAfter, levelBefore, levelAfter, reason }) {
  const titles = {
    admin_add: '➕ Staff agregó XP',
    admin_remove: '➖ Staff quitó XP',
    admin_set: '🛠️ Staff estableció la XP',
    admin_set_level: '🛠️ Staff estableció el nivel',
  };

  return baseLogEmbed({
    color: WARN_COLOR,
    title: titles[type] || '✨ Movimiento de XP (staff)',
    footer: 'XP y niveles',
    fields: [
      { name: 'Usuario', value: userTag(targetUser), inline: true },
      { name: 'Staff', value: userTag(executor), inline: true },
      { name: 'Monto', value: `${amount >= 0 ? '+' : ''}${amount.toLocaleString('es-ES')} XP`, inline: true },
      { name: 'XP anterior → nueva', value: `${xpBefore.toLocaleString('es-ES')} → ${xpAfter.toLocaleString('es-ES')}`, inline: true },
      { name: 'Nivel anterior → nuevo', value: `${levelBefore} → ${levelAfter}`, inline: true },
      { name: 'Motivo', value: reason || 'Sin motivo especificado' },
    ],
  });
}

export function createGiveSuspiciousLogEmbed({ sender, pattern }) {
  const isRepeat = pattern.pattern === 'repeat';
  return baseLogEmbed({
    color: LOG_COLOR,
    footer: 'Economía',
    title: isRepeat ? '⚠️ Patrón sospechoso: transferencias repetidas' : '⚠️ Patrón sospechoso: distribución a múltiples usuarios',
    description: isRepeat
      ? 'Puede ser normal (pagar una deuda), pero conviene revisar si no fue así.'
      : 'Puede indicar una cuenta comprometida repartiendo el balance antes de que lo reviertan.',
    fields: isRepeat
      ? [
          { name: 'Emisor', value: userTag(sender), inline: true },
          { name: 'Receptor', value: `<@${pattern.receiverId}>`, inline: true },
          { name: 'Transferencias', value: `${pattern.count} en ${pattern.windowMinutes} min`, inline: true },
          { name: 'Monto total', value: `${pattern.totalAmount.toLocaleString('es-ES')} monedas` },
        ]
      : [
          { name: 'Emisor', value: userTag(sender), inline: true },
          { name: 'Receptores distintos', value: `${pattern.receiverIds.length}`, inline: true },
          { name: 'Transferencias', value: `${pattern.count} en ${pattern.windowMinutes} min`, inline: true },
          { name: 'A quiénes', value: pattern.receiverIds.map((id) => `<@${id}>`).join(', ') },
        ],
  });
}

// ---- Bans / kicks / timeouts / clear ----

export function createBanLogEmbed({ user, executor, reason }) {
  return baseLogEmbed({
    color: LOG_COLOR,
    title: '🔨 Usuario baneado',
    fields: [
      { name: 'Usuario', value: userTag(user), inline: true },
      { name: 'Baneado por', value: executorText(executor), inline: true },
      { name: 'Motivo', value: reason || 'Sin motivo especificado' },
    ],
  });
}

export function createKickLogEmbed({ user, executor, reason }) {
  return baseLogEmbed({
    color: '#F4A261',
    title: '👢 Usuario expulsado (kick)',
    fields: [
      { name: 'Usuario', value: userTag(user), inline: true },
      { name: 'Expulsado por', value: executorText(executor), inline: true },
      { name: 'Motivo', value: reason || 'Sin motivo especificado' },
    ],
  });
}

export function createTimeoutLogEmbed({ user, executor, reason, until, removed }) {
  const fields = [
    { name: 'Usuario', value: userTag(user), inline: true },
    { name: removed ? 'Removido por' : 'Aplicado por', value: executorText(executor), inline: true },
  ];
  if (!removed && until) fields.push({ name: 'Hasta', value: `<t:${Math.floor(until / 1000)}:F>` });
  fields.push({ name: 'Motivo', value: reason || 'Sin motivo especificado' });

  return baseLogEmbed({
    color: removed ? OK_COLOR : WARN_COLOR,
    title: removed ? '🔊 Timeout removido' : '🔇 Usuario silenciado (timeout)',
    fields,
  });
}

export function createAntiSpamLogEmbed({ user, channel, reason, timedOut }) {
  return baseLogEmbed({
    color: LOG_COLOR,
    title: '🚨 Auto-moderación: spam detectado',
    fields: [
      { name: 'Usuario', value: userTag(user), inline: true },
      { name: 'Canal', value: `${channel}`, inline: true },
      { name: 'Motivo', value: reason, inline: true },
      { name: 'Timeout aplicado', value: timedOut ? '✅ 5 minutos' : '❌ No (falta permiso o jerarquía)' },
    ],
  });
}

export function createBulkDeleteLogEmbed({ cantidad, channel, executor, viaComando }) {
  return baseLogEmbed({
    color: LOG_COLOR,
    title: '🧹 Mensajes eliminados en masa',
    fields: [
      { name: 'Cantidad', value: `${cantidad}`, inline: true },
      { name: 'Canal', value: channel ? `<#${channel.id}>` : 'Desconocido', inline: true },
      { name: viaComando ? 'Ejecutado con /clear por' : 'Eliminado por', value: executorText(executor), inline: true },
    ],
  });
}

// ---- Tienda ----

export function createShopPurchaseLogEmbed({ user, item }) {
  return baseLogEmbed({
    color: '#F4A261',
    title: '🛍️ Compra pendiente de entrega',
    footer: 'Tienda',
    fields: [
      { name: 'Usuario', value: userTag(user), inline: true },
      { name: 'Ítem', value: item.name, inline: true },
      { name: 'Precio', value: `${item.price.toLocaleString('es-ES')} monedas`, inline: true },
      { name: 'Qué hay que hacer', value: item.description },
    ],
  });
}

// ---- Warnings ----

export function createWarnLogEmbed({ user, executor, reason, total }) {
  return baseLogEmbed({
    color: WARN_COLOR,
    title: '⚠️ Advertencia aplicada',
    fields: [
      { name: 'Usuario', value: userTag(user), inline: true },
      { name: 'Advertido por', value: userTag(executor), inline: true },
      { name: 'Total de advertencias', value: `${total}`, inline: true },
      { name: 'Motivo', value: reason || 'Sin motivo especificado' },
    ],
  });
}

export function createUnwarnLogEmbed({ user, executor, detail }) {
  return baseLogEmbed({
    color: OK_COLOR,
    title: '✅ Advertencia removida',
    fields: [
      { name: 'Usuario', value: userTag(user), inline: true },
      { name: 'Removida por', value: userTag(executor), inline: true },
      { name: 'Detalle', value: detail },
    ],
  });
}

// ---- Miembros ----

export function createNicknameChangeLogEmbed({ member, executor, oldNick, newNick }) {
  return baseLogEmbed({
    title: '✏️ Nickname cambiado',
    fields: [
      { name: 'Usuario', value: userTag(member.user), inline: true },
      { name: 'Cambiado por', value: executorText(executor), inline: true },
      { name: 'Antes', value: oldNick || '*(sin nickname)*', inline: true },
      { name: 'Ahora', value: newNick || '*(sin nickname)*', inline: true },
    ],
  });
}

export function createRoleChangeLogEmbed({ member, executor, added, removed }) {
  const fields = [
    { name: 'Usuario', value: userTag(member.user), inline: true },
    { name: 'Modificado por', value: executorText(executor), inline: true },
  ];
  if (added.length > 0) fields.push({ name: '➕ Roles agregados', value: added.map((r) => `${r}`).join(', ') });
  if (removed.length > 0) fields.push({ name: '➖ Roles quitados', value: removed.map((r) => `${r}`).join(', ') });

  return baseLogEmbed({ title: '🎭 Roles actualizados', fields });
}

export function createMemberLeftLogEmbed({ member }) {
  return baseLogEmbed({
    color: NEUTRAL_COLOR,
    title: '🚪 Miembro se fue del servidor',
    fields: [{ name: 'Usuario', value: userTag(member.user), inline: true }],
  });
}

export function createBotAddedLogEmbed({ bot, executor }) {
  return baseLogEmbed({
    title: '🤖 Bot agregado al servidor',
    fields: [
      { name: 'Bot', value: userTag(bot), inline: true },
      { name: 'Agregado por', value: executorText(executor), inline: true },
    ],
  });
}

// ---- Usuario (global) ----

export function createAvatarChangeLogEmbed({ oldUser, newUser }) {
  return baseLogEmbed({
    title: '🖼️ Avatar cambiado',
    description: `👤 ${userTag(newUser)}`,
  })
    .setThumbnail(newUser.displayAvatarURL({ size: 256 }))
    .addFields({ name: 'Avatar anterior', value: oldUser.displayAvatarURL({ size: 256 }) });
}

export function createUsernameChangeLogEmbed({ oldUser, newUser, field }) {
  const label = field === 'globalName' ? 'Nombre visible' : 'Username';
  const oldValue = field === 'globalName' ? oldUser.globalName : oldUser.username;
  const newValue = field === 'globalName' ? newUser.globalName : newUser.username;

  return baseLogEmbed({
    title: `📛 ${label} cambiado`,
    fields: [
      { name: 'Usuario', value: userTag(newUser), inline: true },
      { name: 'Antes', value: oldValue || '*(sin definir)*', inline: true },
      { name: 'Ahora', value: newValue || '*(sin definir)*', inline: true },
    ],
  });
}

// ---- Voz ----

const VOICE_ACTION_LABELS = {
  join: { emoji: '🔊', title: 'Entró a un canal de voz' },
  leave: { emoji: '🔇', title: 'Salió de un canal de voz' },
  move: { emoji: '↔️', title: 'Se movió de canal de voz' },
  mute: { emoji: '🔕', title: 'Se auto-muteó' },
  unmute: { emoji: '🔔', title: 'Se quitó el auto-mute' },
  deafen: { emoji: '🙉', title: 'Se auto-ensordeció' },
  undeafen: { emoji: '👂', title: 'Se quitó el auto-ensordecimiento' },
  'stream-start': { emoji: '🖥️', title: 'Empezó a compartir pantalla' },
  'stream-stop': { emoji: '🖥️', title: 'Dejó de compartir pantalla' },
  'camera-on': { emoji: '📹', title: 'Prendió la cámara' },
  'camera-off': { emoji: '📹', title: 'Apagó la cámara' },
};

export function createVoiceLogEmbed({ member, action, oldChannel, newChannel }) {
  const meta = VOICE_ACTION_LABELS[action];
  const fields = [{ name: 'Usuario', value: userTag(member.user), inline: true }];

  if (action === 'move') {
    fields.push({ name: 'De', value: `${oldChannel}`, inline: true }, { name: 'A', value: `${newChannel}`, inline: true });
  } else if (action === 'join') {
    fields.push({ name: 'Canal', value: `${newChannel}`, inline: true });
  } else if (action === 'leave') {
    fields.push({ name: 'Canal', value: `${oldChannel}`, inline: true });
  } else {
    fields.push({ name: 'Canal', value: `${newChannel || oldChannel}`, inline: true });
  }

  return baseLogEmbed({ color: NEUTRAL_COLOR, title: `${meta.emoji} ${meta.title}`, fields });
}

// ---- Bans ----

export function createUnbanAutoLogEmbed({ user, executor, reason }) {
  return baseLogEmbed({
    color: OK_COLOR,
    title: '✅ Usuario desbaneado',
    fields: [
      { name: 'Usuario', value: userTag(user), inline: true },
      { name: 'Desbaneado por', value: executorText(executor), inline: true },
      { name: 'Motivo', value: reason || 'Sin motivo especificado' },
    ],
  });
}

// ---- Canales ----

export function createChannelLogEmbed({ action, channel, executor, changes }) {
  const titles = { create: '➕ Canal creado', update: '✏️ Canal actualizado', delete: '➖ Canal eliminado' };
  const colors = { create: OK_COLOR, update: WARN_COLOR, delete: LOG_COLOR };

  const fields = [
    { name: 'Canal', value: action === 'delete' ? `#${channel.name}` : `${channel}`, inline: true },
    { name: action === 'create' ? 'Creado por' : action === 'delete' ? 'Eliminado por' : 'Modificado por', value: executorText(executor), inline: true },
  ];
  if (changes?.length > 0) fields.push({ name: 'Cambios', value: changes.join('\n').slice(0, 1024) });

  return baseLogEmbed({ color: colors[action], title: titles[action], fields });
}

// ---- Roles ----

export function createRoleLogEmbed({ action, role, executor, changes }) {
  const titles = { create: '➕ Rol creado', update: '✏️ Rol actualizado', delete: '➖ Rol eliminado' };
  const colors = { create: OK_COLOR, update: WARN_COLOR, delete: LOG_COLOR };

  const fields = [
    { name: 'Rol', value: action === 'delete' ? `@${role.name}` : `${role}`, inline: true },
    { name: action === 'create' ? 'Creado por' : action === 'delete' ? 'Eliminado por' : 'Modificado por', value: executorText(executor), inline: true },
  ];
  if (changes?.length > 0) fields.push({ name: 'Cambios', value: changes.join('\n').slice(0, 1024) });

  return baseLogEmbed({ color: colors[action], title: titles[action], fields });
}

// ---- Invites ----

export function createInviteLogEmbed({ action, invite, executor }) {
  if (action === 'create') {
    return baseLogEmbed({
      color: OK_COLOR,
      title: '🔗 Invite creada',
      fields: [
        { name: 'Código', value: `\`${invite.code}\``, inline: true },
        { name: 'Canal', value: invite.channel ? `${invite.channel}` : 'Desconocido', inline: true },
        { name: 'Creada por', value: invite.inviter ? userTag(invite.inviter) : 'Desconocido', inline: true },
        { name: 'Usos máximos', value: invite.maxUses > 0 ? `${invite.maxUses}` : 'Ilimitados', inline: true },
        { name: 'Expira', value: invite.expiresTimestamp ? `<t:${Math.floor(invite.expiresTimestamp / 1000)}:R>` : 'Nunca', inline: true },
      ],
    });
  }

  return baseLogEmbed({
    color: LOG_COLOR,
    title: '🔗 Invite eliminada',
    fields: [
      { name: 'Código', value: `\`${invite.code}\``, inline: true },
      { name: 'Canal', value: invite.channel ? `${invite.channel}` : 'Desconocido', inline: true },
      { name: 'Eliminada por', value: executorText(executor), inline: true },
    ],
  });
}

// ---- Emojis / Stickers ----

function createExpressionLogEmbed({ kind, action, item, executor }) {
  const label = kind === 'emoji' ? 'Emoji' : 'Sticker';
  const titles = { create: `➕ ${label} agregado`, update: `✏️ ${label} renombrado`, delete: `➖ ${label} eliminado` };
  const colors = { create: OK_COLOR, update: WARN_COLOR, delete: LOG_COLOR };

  const embed = baseLogEmbed({
    color: colors[action],
    title: titles[action],
    fields: [
      { name: 'Nombre', value: `${item.name}`, inline: true },
      { name: action === 'create' ? 'Agregado por' : action === 'delete' ? 'Eliminado por' : 'Modificado por', value: executorText(executor), inline: true },
    ],
  });

  if (kind === 'emoji' && item.imageURL) embed.setThumbnail(item.imageURL());
  return embed;
}

export const createEmojiLogEmbed = (args) => createExpressionLogEmbed({ kind: 'emoji', ...args });
export const createStickerLogEmbed = (args) => createExpressionLogEmbed({ kind: 'sticker', ...args });

// ---- Webhooks ----

export function createWebhookLogEmbed({ action, channel, executor, webhookName }) {
  const titles = { create: '🪝 Webhook creado', update: '🪝 Webhook actualizado', delete: '🪝 Webhook eliminado' };
  const colors = { create: OK_COLOR, update: WARN_COLOR, delete: LOG_COLOR };

  return baseLogEmbed({
    color: colors[action] || NEUTRAL_COLOR,
    title: titles[action] || '🪝 Webhook modificado',
    fields: [
      { name: 'Canal', value: `${channel}`, inline: true },
      { name: 'Nombre', value: webhookName || 'Desconocido', inline: true },
      { name: 'Ejecutado por', value: executorText(executor), inline: true },
    ],
  });
}

// ---- Threads ----

export function createThreadLogEmbed({ action, thread, executor, extra }) {
  const titles = { create: '🧵 Hilo creado', update: '🧵 Hilo actualizado', delete: '🧵 Hilo eliminado' };
  const colors = { create: OK_COLOR, update: WARN_COLOR, delete: LOG_COLOR };

  const fields = [
    { name: 'Hilo', value: action === 'delete' ? thread.name : `${thread}`, inline: true },
    { name: 'Canal padre', value: thread.parent ? `${thread.parent}` : 'Desconocido', inline: true },
    { name: action === 'create' ? 'Creado por' : action === 'delete' ? 'Eliminado por' : 'Modificado por', value: executorText(executor), inline: true },
  ];
  if (extra) fields.push({ name: 'Detalle', value: extra });

  return baseLogEmbed({ color: colors[action], title: titles[action], fields });
}

// ---- XP / Niveles ----

export function createLevelUpLogEmbed({ member, previousLevel, newLevel, totalXp }) {
  return baseLogEmbed({
    color: OK_COLOR,
    title: '⭐ Usuario subió de nivel',
    fields: [
      { name: 'Usuario', value: userTag(member.user), inline: true },
      { name: 'Nivel anterior', value: `${previousLevel}`, inline: true },
      { name: 'Nivel nuevo', value: `${newLevel}`, inline: true },
      { name: 'XP total', value: `${totalXp.toLocaleString('es-ES')}`, inline: true },
    ],
  });
}

export function createLevelRoleAssignedLogEmbed({ member, role, level }) {
  return baseLogEmbed({
    color: OK_COLOR,
    title: '🏆 Rol de nivel asignado',
    fields: [
      { name: 'Usuario', value: userTag(member.user), inline: true },
      { name: 'Nivel', value: `${level}`, inline: true },
      { name: 'Rol', value: `${role}`, inline: true },
    ],
  });
}

export function createLevelRoleErrorLogEmbed({ member, level, roleId, reason }) {
  return baseLogEmbed({
    color: LOG_COLOR,
    title: '⚠️ No se pudo asignar el rol de nivel',
    fields: [
      { name: 'Usuario', value: userTag(member.user), inline: true },
      { name: 'Nivel', value: `${level}`, inline: true },
      { name: 'Rol configurado', value: `\`${roleId}\``, inline: true },
      { name: 'Motivo', value: reason },
    ],
  });
}

// ---- Servidor ----

export function createGuildUpdateLogEmbed({ executor, changes }) {
  return baseLogEmbed({
    color: WARN_COLOR,
    title: '🏠 Configuración del servidor actualizada',
    fields: [
      { name: 'Modificado por', value: executorText(executor), inline: true },
      { name: 'Cambios', value: changes.join('\n').slice(0, 1024) },
    ],
  });
}

// Distinto de createGuildUpdateLogEmbed a propósito: ese es para cambios NATIVOS de
// Discord (nombre/ícono/banner del server, vía guildUpdate.js); este es para cambios en
// guild_config — la configuración propia de Nexo (/setup, /config) — para que en el
// canal de logs quede claro de cuál de las dos cosas se trata.
export function createBotConfigLogEmbed({ executor, changes }) {
  return baseLogEmbed({
    color: WARN_COLOR,
    title: '⚙️ Configuración de Nexo actualizada',
    fields: [
      { name: 'Modificado por', value: executorText(executor), inline: true },
      { name: 'Cambios', value: changes.join('\n').slice(0, 1024) },
    ],
  });
}
