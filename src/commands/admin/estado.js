// Salud del bot, no popularidad de comandos — eso ya lo cubre /metricas. /estado es
// para diagnosticar sin tener que ir a mirar Railway: ¿está vivo el gateway?, ¿responde
// Supabase?, ¿cuántos sistemas en vivo tiene prendidos este server ahora mismo?
import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { isStaff } from '../../utils/permissions.js';
import { pingSupabase } from '../../supabaseClient.js';
import { getGuildGiveawaysForAutocomplete } from '../../utils/giveawaysStore.js';
import { getAllTempChannels } from '../../utils/tempVoiceStore.js';
import { getSession } from '../../utils/musicSessionStore.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('estado')
  .setDescription('Estado técnico del bot: latencia, conexión a la base, sistemas activos en este servidor.')
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
  const musicSession = getSession(interaction.guildId);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🩺 Estado de Nexo Bot')
    .addFields(
      { name: '📡 Latencia (gateway)', value: `${interaction.client.ws.ping}ms`, inline: true },
      { name: '🗄️ Supabase', value: supabaseStatus.ok ? `✅ OK (${supabaseStatus.ms}ms)` : '❌ Sin conexión', inline: true },
      { name: '🌐 Servidores totales', value: `${interaction.client.guilds.cache.size}`, inline: true },
      { name: '⏱️ En línea desde', value: `<t:${onlineSinceTimestamp}:R>`, inline: true },
      { name: '🎉 Sorteos activos (este server)', value: `${activeGiveaways.length}`, inline: true },
      { name: '🔊 Salas de voz temporales activas', value: `${tempRooms.length}`, inline: true },
      { name: '🎵 Música', value: musicSession ? `Sí (${musicSession.queue.length} en cola)` : 'Inactiva', inline: true },
    )
    .setFooter({ text: `${BRAND_NAME} • Usá /metricas para ver los comandos más usados` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
