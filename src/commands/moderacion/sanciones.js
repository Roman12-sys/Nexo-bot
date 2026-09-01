import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { isStaff, getModerationBlockReason } from '../../utils/permissions.js';
import { getGuildConfig } from '../../utils/guildConfigStore.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';
import { getActiveTimeouts, getPunishedMembers, getBannedUsers } from '../../utils/sanctions.js';
import { getGuildWarns, clearWarns } from '../../utils/warnsStore.js';
import { createTimeoutLogEmbed, createPunishLogEmbed, createUnbanAutoLogEmbed, createUnwarnLogEmbed } from '../../utils/logEmbeds.js';
import { registerButtonPrefix } from '../../components/buttons.js';
import { registerSelectPrefix } from '../../components/selects.js';
import { recordModerationAction, getUserModerationActions } from '../../utils/moderationActionsStore.js';
import { revokePunishment } from '../../utils/punishEngine.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';

const ACTION_LABELS = {
  ban: '🔨 Ban',
  kick: '👢 Kick',
  timeout: '🔇 Timeout',
  timeout_remove: '🔊 Timeout removido',
  punish: '🚫 Restricción aplicada',
  punish_remove: '✅ Restricción removida',
  unban: '✅ Desbaneo',
};
const HISTORIAL_PAGE_SIZE = 5;

function buildHistorialEmbed(targetUser, list, page) {
  const totalPages = Math.max(1, Math.ceil(list.length / HISTORIAL_PAGE_SIZE));
  const clampedPage = Math.min(Math.max(0, page), totalPages - 1);
  const slice = list.slice(clampedPage * HISTORIAL_PAGE_SIZE, clampedPage * HISTORIAL_PAGE_SIZE + HISTORIAL_PAGE_SIZE);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
    .setTitle(`📜 Historial de sanciones de ${targetUser.tag}`)
    .setFooter({ text: `${BRAND_NAME} • Página ${clampedPage + 1}/${totalPages} • ${list.length} acción(es) • No incluye advertencias, usá /warns` })
    .setTimestamp();

  if (list.length === 0) {
    embed.setDescription('Este usuario no tiene sanciones registradas (bans, kicks, timeouts, restricciones).');
  } else {
    embed.addFields(
      slice.map((a) => {
        // QUÉ CAMBIÓ: moderation_actions.extra.until (guardado por /timeout desde
        // siempre) ahora se muestra acá — antes se guardaba correctamente pero el
        // historial del panel lo ignoraba por completo. `a.extra` es siempre un objeto
        // (nunca null/undefined, ver rowToAction en moderationActionsStore.js), así que
        // leer `.until` de una acción sin duración (o de un tipo que no sea timeout)
        // simplemente da undefined y no agrega la línea — no rompe nada.
        // MOTIVO: auditoría Fase 2B, sección 4.
        const untilLine =
          a.actionType === 'timeout' && a.extra?.until ? `\nHasta: <t:${Math.floor(a.extra.until / 1000)}:f>` : '';
        return {
          name: `${ACTION_LABELS[a.actionType] || a.actionType} · <t:${Math.floor(a.timestamp / 1000)}:f>`,
          value: `${a.reason || 'Sin motivo especificado'} — por <@${a.moderatorId}>${untilLine}`,
        };
      }),
    );
  }

  return { embed, clampedPage, totalPages };
}

function buildHistorialRow(targetUserId, clampedPage, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`sanciones_hist_page_${clampedPage - 1}_${targetUserId}`)
      .setLabel('◀️ Anterior')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clampedPage <= 0),
    new ButtonBuilder()
      .setCustomId(`sanciones_hist_page_${clampedPage + 1}_${targetUserId}`)
      .setLabel('Siguiente ▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clampedPage >= totalPages - 1),
  );
}

export const data = new SlashCommandBuilder()
  .setName('sanciones')
  .setDescription('Panel para ver y quitar sanciones activas, o el historial de un usuario puntual.')
  .addUserOption((o) => o.setName('usuario').setDescription('Si lo completás, muestra el historial de sanciones de ese usuario').setRequired(false))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!(await isStaff(interaction))) {
    await interaction.reply({ content: '❌ No tenés permisos para usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  const targetUser = interaction.options.getUser('usuario');
  if (targetUser) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const list = await getUserModerationActions(interaction.guildId, targetUser.id);
    const { embed, clampedPage, totalPages } = buildHistorialEmbed(targetUser, list, 0);
    const components = list.length > HISTORIAL_PAGE_SIZE ? [buildHistorialRow(targetUser.id, clampedPage, totalPages)] : [];
    await interaction.editReply({ embeds: [embed], components });
    return;
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sanciones_timeouts').setLabel('⏱️ Timeouts activos').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('sanciones_punish').setLabel('🚫 Sancionados').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('sanciones_bans').setLabel('🔨 Baneados').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('sanciones_warns').setLabel('⚠️ Con advertencias').setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({ content: 'Elegí qué querés revisar (o usá `/sanciones usuario:` para ver el historial de alguien puntual):', components: [row], flags: MessageFlags.Ephemeral });
}

registerButtonPrefix('sanciones_hist_page_', async (i) => {
  if (!(await isStaff(i))) return i.reply({ content: '❌ No tenés permisos.', flags: MessageFlags.Ephemeral });

  // deferUpdate() apenas se confirma el permiso — antes el único ack (i.update) llegaba
  // recién después de 2 awaits (users.fetch + getUserModerationActions), lo que
  // arriesgaba "Unknown interaction" si sumaban más de 3s. Ver sección 3 de la
  // auditoría Fase 2B.
  await i.deferUpdate();

  const [pageRaw, targetUserId] = i.customId.slice('sanciones_hist_page_'.length).split('_');
  const targetUser = await i.client.users.fetch(targetUserId).catch(() => null);
  if (!targetUser) return i.editReply({ content: '❌ No se pudo encontrar a ese usuario.', embeds: [], components: [] });

  const list = await getUserModerationActions(i.guildId, targetUserId);
  const { embed, clampedPage, totalPages } = buildHistorialEmbed(targetUser, list, parseInt(pageRaw, 10));
  await i.editReply({ embeds: [embed], components: [buildHistorialRow(targetUserId, clampedPage, totalPages)] });
});

// ---------- Botones: listar y armar el select correspondiente ----------

registerButtonPrefix('sanciones_timeouts', async (i) => {
  if (!(await isStaff(i))) return i.reply({ content: '❌ No tenés permisos.', flags: MessageFlags.Ephemeral });
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const timedOut = await getActiveTimeouts(i.guild);
  if (timedOut.size === 0) return i.editReply({ content: 'No hay timeouts activos.' });

  const options = timedOut.first(25).map((m) => ({
    label: m.user.tag.slice(0, 100),
    description: `Hasta ${new Date(m.communicationDisabledUntilTimestamp).toLocaleString('es-ES')}`.slice(0, 100),
    value: m.id,
  }));
  const select = new StringSelectMenuBuilder().setCustomId('sanciones_select_timeout').setPlaceholder('Elegí a quién quitarle el timeout').addOptions(options);
  const overflow = timedOut.size > 25 ? ` — mostrando los 25 más recientes, hay ${timedOut.size - 25} más` : '';
  await i.editReply({ content: `Timeouts activos (${timedOut.size})${overflow}:`, components: [new ActionRowBuilder().addComponents(select)] });
});

registerButtonPrefix('sanciones_punish', async (i) => {
  if (!(await isStaff(i))) return i.reply({ content: '❌ No tenés permisos.', flags: MessageFlags.Ephemeral });
  const cfg = await getGuildConfig(i.guildId);
  if (!cfg.punish_role_id) return i.reply({ content: '⚠️ El rol de castigo no está configurado (`/config rol-castigo`).', flags: MessageFlags.Ephemeral });

  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const punished = await getPunishedMembers(i.guild, cfg.punish_role_id);
  if (punished.size === 0) return i.editReply({ content: 'No hay nadie sancionado actualmente.' });

  const options = punished.first(25).map((m) => ({ label: m.user.tag.slice(0, 100), value: m.id }));
  const select = new StringSelectMenuBuilder().setCustomId('sanciones_select_punish').setPlaceholder('Elegí a quién quitarle la restricción').addOptions(options);
  const overflow = punished.size > 25 ? ` — mostrando 25, hay ${punished.size - 25} más` : '';
  await i.editReply({ content: `Sancionados (${punished.size})${overflow}:`, components: [new ActionRowBuilder().addComponents(select)] });
});

registerButtonPrefix('sanciones_bans', async (i) => {
  if (!(await isStaff(i))) return i.reply({ content: '❌ No tenés permisos.', flags: MessageFlags.Ephemeral });
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const bans = await getBannedUsers(i.guild);
  if (bans.size === 0) return i.editReply({ content: 'No hay usuarios baneados.' });

  const options = [...bans.values()].slice(0, 25).map((b) => ({ label: b.user.tag.slice(0, 100), value: b.user.id }));
  const select = new StringSelectMenuBuilder().setCustomId('sanciones_select_ban').setPlaceholder('Elegí a quién desbanear').addOptions(options);
  const overflow = bans.size > 25 ? ` — mostrando 25, hay ${bans.size - 25} más` : '';
  await i.editReply({ content: `Baneados (${bans.size})${overflow}:`, components: [new ActionRowBuilder().addComponents(select)] });
});

registerButtonPrefix('sanciones_warns', async (i) => {
  if (!(await isStaff(i))) return i.reply({ content: '❌ No tenés permisos.', flags: MessageFlags.Ephemeral });
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const guildWarns = await getGuildWarns(i.guildId);
  const userIds = Object.keys(guildWarns).filter((id) => (guildWarns[id] || []).length > 0);
  if (userIds.length === 0) return i.editReply({ content: 'Nadie tiene advertencias activas.' });

  const options = [];
  for (const id of userIds.slice(0, 25)) {
    const user = await i.client.users.fetch(id).catch(() => null);
    options.push({
      label: (user?.tag || id).slice(0, 100),
      description: `${guildWarns[id].length} advertencia(s)`,
      value: id,
    });
  }
  const select = new StringSelectMenuBuilder().setCustomId('sanciones_select_warn').setPlaceholder('Elegí a quién borrarle TODAS sus advertencias').addOptions(options);
  const overflow = userIds.length > 25 ? ` — mostrando 25, hay ${userIds.length - 25} más` : '';
  await i.editReply({ content: `Usuarios con advertencias (${userIds.length})${overflow}:`, components: [new ActionRowBuilder().addComponents(select)] });
});

// ---------- Selects: aplicar la acción elegida ----------

// Envía el log de una acción del panel ya aplicada — atrapa sus propios errores para
// que un log fallido nunca aparente que la acción en sí falló (interactionCreate.js no
// tiene forma de distinguir eso de un error real si esto no se atrapa acá).
async function sendPanelLog(interaction, category, embed) {
  try {
    const logChannel = await getGuildLogChannel(interaction.client, interaction.guildId, category);
    if (logChannel) await logChannel.send({ embeds: [embed] });
  } catch (error) {
    console.error('⚠️ No se pudo registrar una acción del panel /sanciones en el canal de logs:', error);
  }
}

registerSelectPrefix('sanciones_select_timeout', async (i) => {
  if (!(await isStaff(i))) return i.reply({ content: '❌ No tenés permisos.', flags: MessageFlags.Ephemeral });

  // Defer apenas se confirma el permiso — antes el único ack (i.reply) llegaba recién
  // después de members.fetch + member.timeout(), lo que arriesgaba "Unknown
  // interaction" aunque la acción SÍ se hubiera aplicado. Todas las ramas de este
  // handler ya eran ephemeral, así que deferir ephemeral no cambia ninguna respuesta
  // visible. Ver sección 3 de la auditoría Fase 2B.
  await i.deferReply({ flags: MessageFlags.Ephemeral });

  const userId = i.values[0];
  const member = await i.guild.members.fetch(userId).catch(() => null);
  if (!member) return i.editReply({ content: '❌ No se encontró al usuario.' });

  // Mismo chequeo de jerarquía que /timeout — el panel no puede saltárselo.
  const blockReason = getModerationBlockReason(i, member);
  if (blockReason) return i.editReply({ content: blockReason });
  if (!member.moderatable) return i.editReply({ content: '❌ No puedo modificar el timeout de este usuario.' });

  await member.timeout(null);
  await i.editReply({ content: `✅ Se le quitó el timeout a ${member.user.tag}.` });
  // Público a propósito, mismo criterio que /timeout directo — la única diferencia es
  // que esto se hizo desde el panel, no debería quedar oculto por eso.
  await i.channel.send({ content: `🔊 ${i.user} le quitó el timeout a ${member.user}.` }).catch(() => {});

  await sendPanelLog(i, 'moderation', createTimeoutLogEmbed({ user: member.user, executor: i.user, reason: null, until: null, removed: true }));
  await recordModerationAction(i.guildId, member.user.id, { actionType: 'timeout_remove', moderatorId: i.user.id, reason: null }).catch(() => {});
});

registerSelectPrefix('sanciones_select_punish', async (i) => {
  if (!(await isStaff(i))) return i.reply({ content: '❌ No tenés permisos.', flags: MessageFlags.Ephemeral });

  // Defer apenas se confirma el permiso — mismo motivo que sanciones_select_timeout
  // (sección 3 de la auditoría Fase 2B); todas las ramas ya eran ephemeral.
  await i.deferReply({ flags: MessageFlags.Ephemeral });

  const cfg = await getGuildConfig(i.guildId);
  const userId = i.values[0];
  const member = await i.guild.members.fetch(userId).catch(() => null);
  if (!member) return i.editReply({ content: '❌ No se encontró al usuario.' });

  // Mismo chequeo de jerarquía que /unpunish — el panel no puede saltárselo.
  const blockReason = getModerationBlockReason(i, member);
  if (blockReason) return i.editReply({ content: blockReason });

  // QUÉ CAMBIÓ: usa el mismo helper central que /unpunish (revokePunishment) en vez de
  // solo member.roles.remove() — antes, quitar una restricción CON DURACIÓN desde el
  // panel no cancelaba el timer en memoria ni borraba la fila de active_punishments, así
  // que el timer igual disparaba más tarde: quitaba un rol que ya no estaba (no-op) pero
  // igual mandaba un log de "expiración automática" falso sobre algo que el staff ya
  // había resuelto a mano. MOTIVO: auditoría Fase 2B, sección 1B.
  await revokePunishment(i.client, { guildId: i.guildId, userId: member.id, roleId: cfg.punish_role_id, member });

  await i.editReply({ content: `✅ Se le quitó la restricción a ${member.user.tag}.` });
  await i.channel.send({ content: `✅ ${i.user} le quitó la restricción a ${member.user}.` }).catch(() => {});

  await sendPanelLog(i, 'moderation', createPunishLogEmbed({ user: member.user, executor: i.user, reason: null, applied: false }));
  await recordModerationAction(i.guildId, member.user.id, { actionType: 'punish_remove', moderatorId: i.user.id, reason: null }).catch(() => {});
});

registerSelectPrefix('sanciones_select_ban', async (i) => {
  if (!(await isStaff(i))) return i.reply({ content: '❌ No tenés permisos.', flags: MessageFlags.Ephemeral });

  // Defer apenas se confirma el permiso — mismo motivo que los selects de arriba
  // (sección 3 de la auditoría Fase 2B); todas las ramas ya eran ephemeral.
  await i.deferReply({ flags: MessageFlags.Ephemeral });

  const userId = i.values[0];

  const user = await i.client.users.fetch(userId).catch(() => null);
  await i.guild.members.unban(userId);
  await i.editReply({ content: `✅ Se desbaneó a ${user?.tag || userId}.` });
  await i.channel.send({ content: `✅ ${i.user} desbaneó a ${user?.tag || userId}.` }).catch(() => {});

  if (user) {
    await sendPanelLog(i, 'moderation', createUnbanAutoLogEmbed({ user, executor: i.user, reason: null }));
  }
  await recordModerationAction(i.guildId, userId, { actionType: 'unban', moderatorId: i.user.id, reason: null }).catch(() => {});
});

registerSelectPrefix('sanciones_select_warn', async (i) => {
  if (!(await isStaff(i))) return i.reply({ content: '❌ No tenés permisos.', flags: MessageFlags.Ephemeral });

  // Defer apenas se confirma el permiso — mismo motivo que los selects de arriba
  // (sección 3 de la auditoría Fase 2B); todas las ramas ya eran ephemeral.
  await i.deferReply({ flags: MessageFlags.Ephemeral });

  const userId = i.values[0];

  // QUÉ CAMBIÓ: mismo chequeo central de jerarquía que /unwarn — antes el panel podía
  // borrar TODAS las advertencias de alguien con rango igual/superior (o del propio
  // staff, o del bot) sin ningún control, algo que /unwarn directo sí bloqueaba. member
  // puede ser null (el usuario ya no está en el server) — getModerationBlockReason no
  // bloquea en ese caso, mismo criterio que /unwarn.
  // MOTIVO: auditoría Fase 2B, sección 1A.
  const member = await i.guild.members.fetch(userId).catch(() => null);
  const blockReason = getModerationBlockReason(i, member);
  if (blockReason) return i.editReply({ content: blockReason });

  const user = await i.client.users.fetch(userId).catch(() => null);
  const total = await clearWarns(i.guildId, userId);

  await i.editReply({ content: `✅ Se borraron las ${total} advertencia(s) de ${user?.tag || userId}.` });
  await i.channel.send({ content: `✅ ${i.user} borró las ${total} advertencia(s) de ${user?.tag || userId}.` }).catch(() => {});

  if (user) {
    await sendPanelLog(i, 'moderation', createUnwarnLogEmbed({ user, executor: i.user, detail: `Se borraron todas (${total}) desde el panel /sanciones` }));
  }
});
