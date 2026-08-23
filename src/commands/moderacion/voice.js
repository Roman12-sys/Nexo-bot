import { SlashCommandBuilder, ChannelType, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, MessageFlags } from 'discord.js';
import { isStaff } from '../../utils/permissions.js';
import { getGuildVoiceConfig, upsertGuildVoiceConfig, disableGuildVoiceConfig } from '../../utils/voiceConfigStore.js';
import { getAllTempChannels, getGuildVoiceStatsSummary } from '../../utils/tempVoiceStore.js';
import { buildAdminRoomSelect } from '../../utils/tempVoicePanel.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { describeError } from '../../utils/errorMessages.js';

async function handleSetup(interaction) {
  const canal = interaction.options.getChannel('canal');
  const categoria = interaction.options.getChannel('categoria');

  const me = interaction.guild.members.me;
  const faltantes = [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers].filter((p) => !me.permissions.has(p));
  if (faltantes.length > 0) {
    await interaction.reply({
      content: '❌ Al bot le faltan permisos: **Gestionar canales** y/o **Mover miembros**. Otorgáselos antes de activar el sistema.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await upsertGuildVoiceConfig(interaction.guild.id, { createChannelId: canal.id, categoryId: categoria.id, enabled: true });

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('✅ Sistema de salas temporales configurado')
    .addFields(
      { name: 'Canal "Crear sala"', value: `${canal}`, inline: true },
      { name: 'Categoría', value: `${categoria}`, inline: true },
      { name: 'Estado', value: '🟢 Activado', inline: true },
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function handleConfig(interaction) {
  const cfg = await getGuildVoiceConfig(interaction.guild.id);
  if (!cfg) {
    await interaction.reply({ content: 'ℹ️ El sistema de salas temporales no está configurado todavía. Usá `/voice setup`.', flags: MessageFlags.Ephemeral });
    return;
  }

  const canal = cfg.createChannelId ? await interaction.guild.channels.fetch(cfg.createChannelId).catch(() => null) : null;
  const categoria = cfg.categoryId ? await interaction.guild.channels.fetch(cfg.categoryId).catch(() => null) : null;

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('⚙️ Configuración de salas temporales')
    .addFields(
      { name: 'Canal "Crear sala"', value: canal ? `${canal}` : '❌ No existe (ID guardado inválido)', inline: true },
      { name: 'Categoría', value: categoria ? `${categoria}` : cfg.categoryId ? '❌ No existe (ID guardado inválido)' : '— (sin categoría)', inline: true },
      { name: 'Estado', value: cfg.enabled ? '🟢 Activado' : '🔴 Desactivado', inline: true },
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleAdmin(interaction) {
  const records = await getAllTempChannels(interaction.guild.id);
  if (records.length === 0) {
    await interaction.reply({ content: 'ℹ️ No hay salas temporales activas ahora mismo.', flags: MessageFlags.Ephemeral });
    return;
  }

  const select = buildAdminRoomSelect(records, interaction.guild);
  await interaction.reply({
    content: `📋 Salas activas (${records.length}) — elegí una para administrarla:`,
    components: [new ActionRowBuilder().addComponents(select)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleDisable(interaction) {
  const cfg = await getGuildVoiceConfig(interaction.guild.id);
  if (!cfg || !cfg.enabled) {
    await interaction.reply({ content: 'ℹ️ El sistema ya está desactivado.', flags: MessageFlags.Ephemeral });
    return;
  }

  await disableGuildVoiceConfig(interaction.guild.id);
  await interaction.reply({ content: '🔴 Sistema de salas temporales desactivado. Las salas que ya existen se siguen borrando solas al quedar vacías; no se crearán salas nuevas.' });
}

function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours === 0) return `${minutes}min`;
  return `${hours}h ${minutes}min`;
}

// Antes voice_channel_stats se escribía en cada sala cerrada pero ningún comando la
// leía — este es el primero que la consulta.
async function handleEstadisticas(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const summary = await getGuildVoiceStatsSummary(interaction.guild.id);
  if (summary.totalSessions === 0) {
    await interaction.editReply({ content: 'ℹ️ Todavía no se cerró ninguna sala temporal en este servidor.' });
    return;
  }

  const topLines = summary.topOwners.length === 0
    ? 'Sin datos suficientes.'
    : summary.topOwners
        .map((o, i) => `${i + 1}. <@${o.ownerId}> — ${formatDuration(o.durationSeconds)} en ${o.sessions} sala(s)`)
        .join('\n');

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('📊 Estadísticas de salas de voz temporales')
    .addFields(
      { name: 'Salas cerradas (últimas 500)', value: `${summary.totalSessions}`, inline: true },
      { name: 'Tiempo total en voz', value: formatDuration(summary.totalDurationSeconds), inline: true },
      { name: 'Pico de gente en una sala', value: `${summary.peakConcurrent}`, inline: true },
      { name: '🏆 Top dueños por tiempo acumulado', value: topLines },
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

export const data = new SlashCommandBuilder()
  .setName('voice')
  .setDescription('Configura el sistema de canales de voz temporales (Join to Create).')
  .addSubcommand((sub) =>
    sub
      .setName('setup')
      .setDescription('Configura (o reconfigura) el canal "Crear sala" y la categoría de las salas.')
      .addChannelOption((o) => o.setName('canal').setDescription('Canal de voz que dispara la creación de salas').addChannelTypes(ChannelType.GuildVoice).setRequired(true))
      .addChannelOption((o) => o.setName('categoria').setDescription('Categoría donde se crean las salas').addChannelTypes(ChannelType.GuildCategory).setRequired(true)),
  )
  .addSubcommand((sub) => sub.setName('config').setDescription('Muestra la configuración actual del sistema.'))
  .addSubcommand((sub) => sub.setName('disable').setDescription('Desactiva el sistema de salas temporales.'))
  .addSubcommand((sub) => sub.setName('admin').setDescription('Administra las salas temporales activas (staff).'))
  .addSubcommand((sub) => sub.setName('estadisticas').setDescription('Salas más usadas históricamente (duración, sesiones).'))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!(await isStaff(interaction))) {
    await interaction.reply({ content: '❌ No tenés permisos para usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  const sub = interaction.options.getSubcommand();

  try {
    if (sub === 'setup') return await handleSetup(interaction);
    if (sub === 'config') return await handleConfig(interaction);
    if (sub === 'disable') return await handleDisable(interaction);
    if (sub === 'admin') return await handleAdmin(interaction);
    if (sub === 'estadisticas') return await handleEstadisticas(interaction);
  } catch (error) {
    console.error(`❌ Error al ejecutar /voice ${sub}:`, error);
    const errorMsg = { content: describeError(error, '❌ Ocurrió un error al ejecutar el comando.'), flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMsg);
    } else {
      await interaction.reply(errorMsg);
    }
  }
}
