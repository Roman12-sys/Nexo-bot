import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { isStaff } from '../../utils/permissions.js';
import { getGuildConfig } from '../../utils/guildConfigStore.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';
import { getActiveTimeouts, getPunishedMembers, getBannedUsers } from '../../utils/sanctions.js';
import { getGuildWarns, clearWarns } from '../../utils/warnsStore.js';
import { createTimeoutLogEmbed, createPunishLogEmbed, createUnbanAutoLogEmbed, createUnwarnLogEmbed } from '../../utils/logEmbeds.js';
import { registerButtonPrefix } from '../../components/buttons.js';
import { registerSelectPrefix } from '../../components/selects.js';

export const data = new SlashCommandBuilder()
  .setName('sanciones')
  .setDescription('Panel para ver y quitar sanciones activas.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!(await isStaff(interaction))) {
    await interaction.reply({ content: '❌ No tenés permisos para usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sanciones_timeouts').setLabel('⏱️ Timeouts activos').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('sanciones_punish').setLabel('🚫 Sancionados').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('sanciones_bans').setLabel('🔨 Baneados').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('sanciones_warns').setLabel('⚠️ Con advertencias').setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({ content: 'Elegí qué querés revisar:', components: [row], flags: MessageFlags.Ephemeral });
}

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
  await i.editReply({ content: `Timeouts activos (${timedOut.size}):`, components: [new ActionRowBuilder().addComponents(select)] });
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
  await i.editReply({ content: `Sancionados (${punished.size}):`, components: [new ActionRowBuilder().addComponents(select)] });
});

registerButtonPrefix('sanciones_bans', async (i) => {
  if (!(await isStaff(i))) return i.reply({ content: '❌ No tenés permisos.', flags: MessageFlags.Ephemeral });
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const bans = await getBannedUsers(i.guild);
  if (bans.size === 0) return i.editReply({ content: 'No hay usuarios baneados.' });

  const options = [...bans.values()].slice(0, 25).map((b) => ({ label: b.user.tag.slice(0, 100), value: b.user.id }));
  const select = new StringSelectMenuBuilder().setCustomId('sanciones_select_ban').setPlaceholder('Elegí a quién desbanear').addOptions(options);
  await i.editReply({ content: `Baneados (${bans.size}):`, components: [new ActionRowBuilder().addComponents(select)] });
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
  await i.editReply({ content: `Usuarios con advertencias (${userIds.length}):`, components: [new ActionRowBuilder().addComponents(select)] });
});

// ---------- Selects: aplicar la acción elegida ----------

registerSelectPrefix('sanciones_select_timeout', async (i) => {
  if (!(await isStaff(i))) return i.reply({ content: '❌ No tenés permisos.', flags: MessageFlags.Ephemeral });
  const userId = i.values[0];
  const member = await i.guild.members.fetch(userId).catch(() => null);
  if (!member) return i.reply({ content: '❌ No se encontró al usuario.', flags: MessageFlags.Ephemeral });

  await member.timeout(null);
  await i.reply({ content: `✅ Se le quitó el timeout a ${member.user.tag}.`, flags: MessageFlags.Ephemeral });

  const logChannel = await getGuildLogChannel(i.client, i.guildId, 'moderation');
  if (logChannel) {
    await logChannel.send({ embeds: [createTimeoutLogEmbed({ user: member.user, executor: i.user, reason: null, until: null, removed: true })] });
  }
});

registerSelectPrefix('sanciones_select_punish', async (i) => {
  if (!(await isStaff(i))) return i.reply({ content: '❌ No tenés permisos.', flags: MessageFlags.Ephemeral });
  const cfg = await getGuildConfig(i.guildId);
  const userId = i.values[0];
  const member = await i.guild.members.fetch(userId).catch(() => null);
  if (!member) return i.reply({ content: '❌ No se encontró al usuario.', flags: MessageFlags.Ephemeral });

  await member.roles.remove(cfg.punish_role_id);
  await i.reply({ content: `✅ Se le quitó la restricción a ${member.user.tag}.`, flags: MessageFlags.Ephemeral });

  const logChannel = await getGuildLogChannel(i.client, i.guildId, 'moderation');
  if (logChannel) {
    await logChannel.send({ embeds: [createPunishLogEmbed({ user: member.user, executor: i.user, reason: null, applied: false })] });
  }
});

registerSelectPrefix('sanciones_select_ban', async (i) => {
  if (!(await isStaff(i))) return i.reply({ content: '❌ No tenés permisos.', flags: MessageFlags.Ephemeral });
  const userId = i.values[0];

  const user = await i.client.users.fetch(userId).catch(() => null);
  await i.guild.members.unban(userId);
  await i.reply({ content: `✅ Se desbaneó a ${user?.tag || userId}.`, flags: MessageFlags.Ephemeral });

  if (user) {
    const logChannel = await getGuildLogChannel(i.client, i.guildId, 'moderation');
    if (logChannel) {
      await logChannel.send({ embeds: [createUnbanAutoLogEmbed({ user, executor: i.user, reason: null })] });
    }
  }
});

registerSelectPrefix('sanciones_select_warn', async (i) => {
  if (!(await isStaff(i))) return i.reply({ content: '❌ No tenés permisos.', flags: MessageFlags.Ephemeral });
  const userId = i.values[0];
  const user = await i.client.users.fetch(userId).catch(() => null);
  const total = await clearWarns(i.guildId, userId);

  await i.reply({ content: `✅ Se borraron las ${total} advertencia(s) de ${user?.tag || userId}.`, flags: MessageFlags.Ephemeral });

  if (user) {
    const logChannel = await getGuildLogChannel(i.client, i.guildId, 'moderation');
    if (logChannel) {
      await logChannel.send({ embeds: [createUnwarnLogEmbed({ user, executor: i.user, detail: `Se borraron todas (${total}) desde el panel /sanciones` })] });
    }
  }
});
