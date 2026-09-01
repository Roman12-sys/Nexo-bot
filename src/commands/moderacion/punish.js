import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { createPunishLogEmbed } from '../../utils/logEmbeds.js';
import { isStaff, getModerationBlockReason } from '../../utils/permissions.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';
import { getGuildConfig } from '../../utils/guildConfigStore.js';
import { describeError } from '../../utils/errorMessages.js';
import { recordModerationAction, getGuildFrequentReasons } from '../../utils/moderationActionsStore.js';
import { createActivePunishment } from '../../utils/punishStore.js';
import { schedulePunishExpiry } from '../../utils/punishEngine.js';

// QUÉ CAMBIÓ: opción `duracion` nueva (opcional) + DURATION_MS + lógica de scheduling
// más abajo en execute().
// MOTIVO: auditoría 2026-08-29 (Diagnóstico Nexo, Parte 22) — /punish no tenía
// expiración automática, a diferencia de /timeout. Sin la opción (comportamiento
// exactamente igual que antes): la restricción queda indefinida/manual, sin ninguna
// fila nueva en Supabase.
// VERIFICACIÓN: /punish sin `duracion` se comporta idéntico a antes. /punish con
// duracion:1h crea la fila en active_punishments y el rol se cae solo pasada 1 hora.
const DURATION_MS = { '1h': 60 * 60 * 1000, '6h': 6 * 60 * 60 * 1000, '1d': 24 * 60 * 60 * 1000, '7d': 7 * 24 * 60 * 60 * 1000 };

export const data = new SlashCommandBuilder()
  .setName('punish')
  .setDescription('Restringe a un usuario para que no pueda enviar imágenes ni enlaces.')
  .addUserOption((o) => o.setName('usuario').setDescription('Usuario').setRequired(true))
  .addStringOption((o) => o.setName('motivo').setDescription('Motivo').setRequired(false).setMaxLength(512).setAutocomplete(true))
  .addStringOption((o) =>
    o
      .setName('duracion')
      .setDescription('Se quita sola después de este tiempo (sin elegir, queda indefinida hasta /unpunish)')
      .setRequired(false)
      .addChoices({ name: '1 hora', value: '1h' }, { name: '6 horas', value: '6h' }, { name: '1 día', value: '1d' }, { name: '7 días', value: '7d' }),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setDMPermission(false);

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const reasons = await getGuildFrequentReasons(interaction.guildId, 'punish').catch(() => []);
  const matches = reasons.filter((r) => r.toLowerCase().includes(focused)).map((r) => ({ name: r.slice(0, 100), value: r.slice(0, 100) }));
  await interaction.respond(matches);
}

export async function execute(interaction) {
  if (!(await isStaff(interaction))) {
    await interaction.reply({ content: '❌ No tenés permisos para usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Defer apenas se confirma el permiso — antes el primer reply llegaba recién después
  // de member.roles.add() (+ la escritura de active_punishments cuando hay duración), lo
  // que arriesgaba "Unknown interaction" si esos awaits sumaban más de 3s aunque la
  // restricción SÍ se hubiera aplicado. Ver sección 3 de la auditoría Fase 2B.
  await interaction.deferReply();

  const targetUser = interaction.options.getUser('usuario');
  const motivo = interaction.options.getString('motivo') || 'Sin motivo especificado';
  const duracion = interaction.options.getString('duracion');
  const durationMs = duracion ? DURATION_MS[duracion] : null;

  try {
    const cfg = await getGuildConfig(interaction.guildId);
    if (!cfg.punish_role_id) {
      await interaction.editReply({ content: '⚠️ Este comando no está configurado. Usá `/config rol-castigo` primero.' });
      return;
    }

    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      await interaction.editReply({ content: '❌ No se encontró a ese usuario en el servidor.' });
      return;
    }

    const blockReason = getModerationBlockReason(interaction, member);
    if (blockReason) {
      await interaction.editReply({ content: blockReason });
      return;
    }

    if (member.roles.cache.has(cfg.punish_role_id)) {
      await interaction.editReply({ content: `⚠️ ${targetUser.tag} ya tiene la restricción aplicada.` });
      return;
    }

    const punishRole = interaction.guild.roles.cache.get(cfg.punish_role_id);
    if (!punishRole) {
      await interaction.editReply({ content: '⚠️ El rol de restricción configurado ya no existe. Reconfigurálo con `/config rol-castigo`.' });
      return;
    }
    if (punishRole.position >= interaction.guild.members.me.roles.highest.position) {
      await interaction.editReply({ content: '⚠️ No puedo asignar el rol de restricción — está por encima de mi rol más alto.' });
      return;
    }

    await member.roles.add(cfg.punish_role_id, motivo);

    let expiresAt = null;
    if (durationMs) {
      expiresAt = Date.now() + durationMs;
      await createActivePunishment(interaction.guildId, targetUser.id, cfg.punish_role_id, expiresAt);
      schedulePunishExpiry(interaction.client, { guildId: interaction.guildId, userId: targetUser.id, roleId: cfg.punish_role_id, expiresAt });
    }

    const expiryText = expiresAt ? ` Se le quita sola <t:${Math.floor(expiresAt / 1000)}:R>.` : '';
    await interaction.editReply({ content: `🚫 ${targetUser.tag} ya no puede enviar imágenes ni enlaces.${expiryText}` });

    // Try/catch propio: la restricción ya se aplicó y ya se confirmó — un log fallido
    // no debe mostrarle un error al staff (lo llevaría a reintentar una ya aplicada).
    try {
      const logChannel = await getGuildLogChannel(interaction.client, interaction.guildId, 'moderation');
      if (logChannel) {
        await logChannel.send({ embeds: [createPunishLogEmbed({ user: targetUser, executor: interaction.user, reason: motivo, applied: true })] });
      }
    } catch (logError) {
      console.error('⚠️ No se pudo registrar /punish en el canal de logs:', logError);
    }

    await recordModerationAction(interaction.guildId, targetUser.id, {
      actionType: 'punish',
      moderatorId: interaction.user.id,
      reason: motivo,
    }).catch((e) => console.error('⚠️ No se pudo registrar /punish en el historial de sanciones:', e));
  } catch (error) {
    console.error('❌ Error al ejecutar /punish:', error);
    await interaction.editReply({ content: describeError(error, '❌ Ocurrió un error al aplicar la restricción.') }).catch(() => {});
  }
}
