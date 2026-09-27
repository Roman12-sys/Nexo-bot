// Salud del bot, no popularidad de comandos — eso ya lo cubre /metricas. /estado es
// para diagnosticar sin tener que ir a mirar Railway: ¿está vivo el gateway?, ¿responde
// Supabase?, ¿cuántos sistemas en vivo tiene prendidos este server ahora mismo?
import { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { isStaff, getConfiguredRoleConflicts } from '../../utils/permissions.js';
import { pingSupabase } from '../../supabaseClient.js';
import { getGuildConfig } from '../../utils/guildConfigStore.js';
import { getGuildGiveawaysForAutocomplete } from '../../utils/giveawaysStore.js';
import { getAllTempChannels } from '../../utils/tempVoiceStore.js';
import { getMissingBotPermissions, getBotChannelVisibility, describeChannelVisibility } from '../../utils/botPermissions.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('estado')
  .setDescription('Estado técnico del bot: latencia, conexión a la base, sistemas activos en este servidor.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!(await isStaff(interaction))) {
    await interaction.reply({ content: '❌ No tenés permisos para usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const [supabaseStatus, activeGiveaways, tempRooms] = await Promise.all([
    pingSupabase(),
    getGuildGiveawaysForAutocomplete(interaction.guildId, false).catch(() => []),
    getAllTempChannels(interaction.guildId).catch(() => []),
  ]);

  const onlineSinceTimestamp = Math.floor((Date.now() - interaction.client.uptime) / 1000);

  // QUÉ CAMBIÓ: antes "Supabase" era binario (OK/Sin conexión) y la latencia del gateway
  // mostraba el número crudo de discord.js sin traducir su caso especial — client.ws.ping
  // vale -1 cuando todavía no hubo ningún heartbeat ACK (recién conectado/reconectando),
  // no una latencia real, y mostrarlo como "-1ms" no dice nada útil sin mirar el código.
  // SUPABASE_SLOW_MS es un umbral operativo (no una medición): un round-trip de Supabase
  // normal ronda cientos de ms, no segundos — por encima de eso ya vale la pena que un
  // operador lo note sin tener que entrar a Railway a mirar logs.
  // MOTIVO: auditoría Fase 2C, sección 12 — "que un operador pueda saber que NEXO está
  // degradado por Supabase sin entrar al código".
  const SUPABASE_SLOW_MS = 1000;
  const supabaseLabel = !supabaseStatus.ok
    ? '❌ Sin conexión'
    : supabaseStatus.ms > SUPABASE_SLOW_MS
      ? `🟡 Lento (${supabaseStatus.ms}ms)`
      : `✅ OK (${supabaseStatus.ms}ms)`;
  const gatewayLabel = interaction.client.ws.ping < 0 ? '🟡 Reconectando…' : `${interaction.client.ws.ping}ms`;

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🩺 Estado de Nexo Bot')
    .addFields(
      { name: '📡 Latencia (gateway)', value: gatewayLabel, inline: true },
      { name: '🗄️ Supabase', value: supabaseLabel, inline: true },
      { name: '🌐 Servidores totales', value: `${interaction.client.guilds.cache.size}`, inline: true },
      { name: '⏱️ En línea desde', value: `<t:${onlineSinceTimestamp}:R>`, inline: true },
      { name: '🎉 Sorteos activos (este server)', value: `${activeGiveaways.length}`, inline: true },
      { name: '🔊 Salas de voz temporales activas', value: `${tempRooms.length}`, inline: true },
    )
    .setFooter({ text: `${BRAND_NAME} • Usá /metricas para ver los comandos más usados` })
    .setTimestamp();

  // Fase 4C-1 (guía de permisos) — mismo chequeo que usa /setup al final de la
  // configuración, pero acá disponible en cualquier momento: un permiso sacado por
  // accidente DESPUÉS de /setup (ej. reordenando roles) no se notaba hasta que una
  // feature fallaba en producción sin explicación.
  const missingPermissions = getMissingBotPermissions(interaction.guild);
  embed.addFields({
    name: '🔐 Permisos del bot',
    value:
      missingPermissions.length === 0
        ? '✅ Todo OK'
        : missingPermissions.map((p) => `⚠️ **${p.label}** — afecta: ${p.feature}`).join('\n').slice(0, 1000),
  });

  // 2026-09-27: los permisos del servidor pueden estar bien y los de cada canal
  // negarle todo al bot (Cloud6) — ver getBotChannelVisibility.
  const cfg = await getGuildConfig(interaction.guildId);
  const visibilityLine = describeChannelVisibility(getBotChannelVisibility(interaction.guild, cfg));
  if (visibilityLine) embed.addFields({ name: '👁️ Canales', value: visibilityLine });

  const roleConflicts = getConfiguredRoleConflicts(cfg);
  if (roleConflicts.length > 0) {
    embed.addFields({
      name: '⚠️ Roles en conflicto',
      value: roleConflicts.map((c) => `**${c.label}** (<@&${c.roleId}>) ${c.reason}. Cambialo con \`/config\`.`).join('\n'),
    });
  }

  await interaction.editReply({ embeds: [embed] });
}
