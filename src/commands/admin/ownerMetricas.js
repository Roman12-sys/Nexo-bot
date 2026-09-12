// Observabilidad de negocio (plan de ejecución post-auditoría, Fase 5, 2026-09-12) — el
// ÚNICO comando del proyecto que ve datos de TODOS los servidores a la vez, no de uno
// puntual. Toda la analítica existente (command_usage, guild_daily_stats, /metricas,
// /estado) está estrictamente filtrada por guild — no había ningún lugar donde el
// OPERADOR del bot pudiera ver cuántos servidores tiene en total ni si está creciendo o
// perdiendo servidores con el tiempo.
//
// Deliberadamente NO mencionado en /help ni /helpstaff — cualquier admin de un guild
// puntual que lo viera ahí solo generaría confusión ("¿esto es para mí?") sobre una
// herramienta que jamás va a poder usar (isBotOwner() lo rechaza igual). Mismo criterio
// que el reset manual de lolPatchEngine.js: existe, funciona, no se publicita.
import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { isBotOwner } from '../../utils/botOwner.js';
import { getGuildEventCounts } from '../../utils/botGuildEventsStore.js';
import { GOLD_COLOR, BRAND_NAME } from '../../utils/embeds.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const data = new SlashCommandBuilder()
  .setName('owner-metricas')
  .setDescription('Métricas cross-servidor del operador del bot.')
  .setDMPermission(false);

export async function execute(interaction) {
  // Gate por identidad real, NUNCA por rol de un guild puntual — isStaff()/isAdmin()
  // dan `true` para cualquier admin de SU PROPIO server, que no debería poder ver
  // cuántos servidores tiene el bot en total. Ver botOwner.js.
  if (!(await isBotOwner(interaction.user.id))) {
    await interaction.reply({ content: '❌ No tenés permisos para usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const totalGuilds = interaction.client.guilds.cache.size;
  const [last7, last30] = await Promise.all([
    getGuildEventCounts(Date.now() - 7 * DAY_MS),
    getGuildEventCounts(Date.now() - 30 * DAY_MS),
  ]);

  const embed = new EmbedBuilder()
    .setColor(GOLD_COLOR)
    .setTitle('📈 Métricas cross-servidor')
    .addFields(
      { name: 'Servidores activos ahora', value: `${totalGuilds.toLocaleString('es-ES')}` },
      {
        name: 'Últimos 7 días',
        value: `+${last7.joins} altas · -${last7.leaves} bajas · neto ${last7.joins - last7.leaves >= 0 ? '+' : ''}${last7.joins - last7.leaves}`,
      },
      {
        name: 'Últimos 30 días',
        value: `+${last30.joins} altas · -${last30.leaves} bajas · neto ${last30.joins - last30.leaves >= 0 ? '+' : ''}${last30.joins - last30.leaves}`,
      },
    )
    .setFooter({ text: `${BRAND_NAME} • Historial completo desde que se agregó este registro (2026-09-12)` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
