import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { getUserXp, addXp, setXp, totalXpForLevel } from '../../utils/xpStore.js';
import { processLevelUp } from '../../utils/xpEngine.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { createXpAdminLogEmbed } from '../../utils/logEmbeds.js';
import { isStaff } from '../../utils/permissions.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';

async function logStaffAction(interaction, { type, targetUser, amount, xpBefore, xpAfter, levelBefore, levelAfter, reason }) {
  const logChannel = await getGuildLogChannel(interaction.client, interaction.guildId, 'activity');
  if (!logChannel) return;

  await logChannel.send({
    embeds: [createXpAdminLogEmbed({ type, targetUser, executor: interaction.user, amount, xpBefore, xpAfter, levelBefore, levelAfter, reason })],
  });
}

// Si la acción de staff hizo subir de nivel a alguien, dispara exactamente el mismo
// flujo que una subida de nivel por actividad normal (roles automáticos + anuncio +
// log de subida de nivel). processLevelUp ya no hace nada si newLevel <= previousLevel,
// así que esto es seguro de llamar también cuando se quita o baja XP.
async function maybeProcessLevelUp(interaction, targetUser, result) {
  if (!result.leveledUp) return;
  const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!member) return;

  await processLevelUp(
    member,
    { previousLevel: result.previousLevel, newLevel: result.newLevel, totalXp: result.record.xp },
    interaction.client,
  ).catch((error) => console.error('❌ Error procesando subida de nivel (staff):', error));
}

async function handleAdjust(interaction, direction) {
  const targetUser = interaction.options.getUser('usuario');
  const cantidad = interaction.options.getInteger('cantidad');
  const motivo = interaction.options.getString('motivo') || 'Sin motivo especificado';

  await interaction.deferReply();

  const before = await getUserXp(interaction.guild.id, targetUser.id);
  const type = direction === 1 ? 'admin_add' : 'admin_remove';

  let signedAmount = cantidad;
  if (direction !== 1) {
    // Releemos el total actual justo antes de aplicar el descuento en vez de reusar
    // `before` — si el usuario ganó XP orgánica (grantMessageXp) en el medio, clampear
    // contra el valor viejo puede recortar de más o de menos.
    const current = await getUserXp(interaction.guild.id, targetUser.id);
    signedAmount = -Math.min(cantidad, current.xp);
  }

  const result = await addXp(interaction.guild.id, targetUser.id, signedAmount);

  const verbo = direction === 1 ? 'agregaron' : 'quitaron';
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(direction === 1 ? '➕ XP agregada' : '➖ XP quitada')
    .setDescription(
      `Se le ${verbo} **${cantidad.toLocaleString('es-ES')}** XP a ${targetUser}.\n` +
        `XP: ${before.xp.toLocaleString('es-ES')} → **${result.record.xp.toLocaleString('es-ES')}**\n` +
        `Nivel: ${before.level} → **${result.record.level}**`,
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
  await logStaffAction(interaction, {
    type,
    targetUser,
    amount: signedAmount,
    xpBefore: before.xp,
    xpAfter: result.record.xp,
    levelBefore: before.level,
    levelAfter: result.record.level,
    reason: motivo,
  });
  await maybeProcessLevelUp(interaction, targetUser, result);
}

async function handleSet(interaction) {
  const targetUser = interaction.options.getUser('usuario');
  const cantidad = interaction.options.getInteger('cantidad');
  const motivo = interaction.options.getString('motivo') || 'Sin motivo especificado';

  await interaction.deferReply();

  const before = await getUserXp(interaction.guild.id, targetUser.id);
  const result = await setXp(interaction.guild.id, targetUser.id, cantidad);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🛠️ XP establecida')
    .setDescription(
      `La XP de ${targetUser} pasó de **${before.xp.toLocaleString('es-ES')}** a **${result.record.xp.toLocaleString('es-ES')}**.\n` +
        `Nivel: ${before.level} → **${result.record.level}**`,
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
  await logStaffAction(interaction, {
    type: 'admin_set',
    targetUser,
    amount: result.record.xp - before.xp,
    xpBefore: before.xp,
    xpAfter: result.record.xp,
    levelBefore: before.level,
    levelAfter: result.record.level,
    reason: motivo,
  });
  await maybeProcessLevelUp(interaction, targetUser, result);
}

async function handleSetLevel(interaction) {
  const targetUser = interaction.options.getUser('usuario');
  const nivel = interaction.options.getInteger('nivel');
  const motivo = interaction.options.getString('motivo') || 'Sin motivo especificado';

  await interaction.deferReply();

  const before = await getUserXp(interaction.guild.id, targetUser.id);
  const targetXp = totalXpForLevel(nivel);
  const result = await setXp(interaction.guild.id, targetUser.id, targetXp);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🛠️ Nivel establecido')
    .setDescription(`El nivel de ${targetUser} pasó de **${before.level}** a **${result.record.level}** (${result.record.xp.toLocaleString('es-ES')} XP).`)
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
  await logStaffAction(interaction, {
    type: 'admin_set_level',
    targetUser,
    amount: result.record.xp - before.xp,
    xpBefore: before.xp,
    xpAfter: result.record.xp,
    levelBefore: before.level,
    levelAfter: result.record.level,
    reason: motivo,
  });
  await maybeProcessLevelUp(interaction, targetUser, result);
}

export const data = new SlashCommandBuilder()
  .setName('xp')
  .setDescription('Panel de staff para gestionar la XP y los niveles de un usuario.')
  .addSubcommand((sub) =>
    sub
      .setName('agregar')
      .setDescription('Agrega XP a un usuario.')
      .addUserOption((o) => o.setName('usuario').setDescription('Usuario').setRequired(true))
      .addIntegerOption((o) => o.setName('cantidad').setDescription('Cuánta XP agregar').setRequired(true).setMinValue(1))
      .addStringOption((o) => o.setName('motivo').setDescription('Motivo').setRequired(false).setMaxLength(512)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('quitar')
      .setDescription('Quita XP a un usuario.')
      .addUserOption((o) => o.setName('usuario').setDescription('Usuario').setRequired(true))
      .addIntegerOption((o) => o.setName('cantidad').setDescription('Cuánta XP quitar').setRequired(true).setMinValue(1))
      .addStringOption((o) => o.setName('motivo').setDescription('Motivo').setRequired(false).setMaxLength(512)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('establecer')
      .setDescription('Fija la XP total de un usuario a una cantidad exacta.')
      .addUserOption((o) => o.setName('usuario').setDescription('Usuario').setRequired(true))
      .addIntegerOption((o) => o.setName('cantidad').setDescription('XP total exacta a fijar').setRequired(true).setMinValue(0))
      .addStringOption((o) => o.setName('motivo').setDescription('Motivo').setRequired(false).setMaxLength(512)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('nivel')
      .setDescription('Fija el nivel exacto de un usuario (calcula la XP correspondiente).')
      .addUserOption((o) => o.setName('usuario').setDescription('Usuario').setRequired(true))
      .addIntegerOption((o) => o.setName('nivel').setDescription('Nivel exacto a fijar').setRequired(true).setMinValue(0))
      .addStringOption((o) => o.setName('motivo').setDescription('Motivo').setRequired(false).setMaxLength(512)),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!(await isStaff(interaction))) {
    await interaction.reply({ content: '❌ No tenés permisos para usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  const sub = interaction.options.getSubcommand();

  try {
    if (sub === 'agregar') return await handleAdjust(interaction, 1);
    if (sub === 'quitar') return await handleAdjust(interaction, -1);
    if (sub === 'establecer') return await handleSet(interaction);
    if (sub === 'nivel') return await handleSetLevel(interaction);
  } catch (error) {
    console.error(`❌ Error al ejecutar /xp ${sub}:`, error);
    const errorMsg = { content: '❌ Ocurrió un error al ejecutar el comando.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMsg);
    } else {
      await interaction.reply(errorMsg);
    }
  }
}
