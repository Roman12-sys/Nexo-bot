import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { getUserXp, getLevelProgress, getRank } from '../../utils/xpStore.js';
import { getUserEconomy } from '../../utils/economyStore.js';
import { getUserTrivia, getPlayStatus } from '../../utils/triviaStore.js';
import { getUserWarns } from '../../utils/warnsStore.js';
import { getUserWinCount } from '../../utils/giveawaysStore.js';
import { getUserReminders } from '../../utils/remindersStore.js';
import { buildInventoryEmbed } from '../economia/inventory.js';
import { COOLDOWN_MS as DAILY_COOLDOWN_MS } from '../economia/daily.js';
import { COOLDOWN_MS as WORK_COOLDOWN_MS } from '../economia/work.js';
import { getUnlockedAchievementIds, buildLogrosEmbed, ACHIEVEMENTS } from '../../utils/achievements.js';
import { getUnlockedGuildAchievementIds, buildGuildLogrosEmbed } from '../../utils/guildAchievements.js';
import { BRAND_COLOR, BRAND_NAME, buildProgressBar, progressPercent } from '../../utils/embeds.js';
import { registerButtonPrefix } from '../../components/buttons.js';

// "Podés volver a: ..." — <t:...:R> ya traducido por Discord si está listo, o el
// timestamp de cuándo vuelve a estar disponible si no.
function cooldownLine(label, lastTimestamp, cooldownMs) {
  const readyAt = lastTimestamp + cooldownMs;
  return readyAt <= Date.now() ? `${label}: ✅ Disponible` : `${label}: <t:${Math.floor(readyAt / 1000)}:R>`;
}

// Vista principal: solo lo esencial de un vistazo. El detalle (trivia %, cuenta creada,
// etc.) queda atrás del botón "📊 Estadísticas" para no convertir esto en una pared de texto.
async function buildPerfilEmbed(guild, targetUser, member) {
  const guildId = guild.id;
  // QUÉ CAMBIÓ: se sacó getUserReputation del Promise.all (7 lecturas en vez de 8).
  // MOTIVO: auditoría 2026-08-29 (Diagnóstico Nexo, Parte 11) — reputación eliminada.
  const [xp, rank, economy, trivia, triviaStatus, warns, wins, achievements] = await Promise.all([
    getUserXp(guildId, targetUser.id),
    getRank(guildId, targetUser.id),
    getUserEconomy(guildId, targetUser.id),
    getUserTrivia(guildId, targetUser.id),
    getPlayStatus(guildId, targetUser.id),
    getUserWarns(guildId, targetUser.id),
    getUserWinCount(guildId, targetUser.id),
    getUnlockedAchievementIds(guildId, targetUser.id),
  ]);
  const progress = getLevelProgress(xp.xp);

  const joinedTimestamp = member?.joinedTimestamp ? Math.floor(member.joinedTimestamp / 1000) : null;
  const pct = progressPercent(progress.currentLevelXp, progress.xpForNextLevel);

  // Reorganizado en 3 grupos (progreso / actividad / al día) en vez de 9 campos sueltos
  // al mismo nivel — cada campo NO inline fuerza una fila nueva en Discord, así que
  // sirve de separador visual real sin necesitar un "header" de mentira. Warns y
  // sorteos ganados salen de acá (casi siempre están en 0, no aportan de un vistazo) —
  // siguen en el botón "📊 Estadísticas" de abajo, que ya los mostraba.
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setAuthor({ name: targetUser.tag, iconURL: targetUser.displayAvatarURL() })
    .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
    .setTitle(`👤 Perfil de ${BRAND_NAME}`)
    .addFields(
      {
        name: '⭐ Nivel',
        value: `${progress.level}${xp.prestige > 0 ? ` ⭐×${xp.prestige}` : ''}${rank ? ` · #${rank} del ranking` : ' · sin ranking todavía'}`,
        inline: true,
      },
      {
        name: '✨ XP',
        value: `${progress.currentLevelXp.toLocaleString('es-ES')} / ${progress.xpForNextLevel.toLocaleString('es-ES')}`,
        inline: true,
      },
      { name: '💰 Balance', value: `${economy.balance.toLocaleString('es-ES')} monedas`, inline: true },
      { name: '📈 Progreso de nivel', value: `${buildProgressBar(progress.currentLevelXp, progress.xpForNextLevel)} ${pct}%` },
      { name: '🧠 Trivia', value: `${trivia.points} puntos`, inline: true },
      { name: '🏅 Logros', value: `${achievements.size}/${ACHIEVEMENTS.length}`, inline: true },
      {
        name: '⏳ Al día',
        value: [
          cooldownLine('/daily', economy.lastDaily, DAILY_COOLDOWN_MS) + (economy.dailyStreak > 1 ? ` (🔥${economy.dailyStreak})` : ''),
          cooldownLine('/work', economy.lastWork, WORK_COOLDOWN_MS),
          triviaStatus.allowed ? '/trivia: ✅ Disponible' : `/trivia: <t:${Math.floor(triviaStatus.resetAt / 1000)}:R>`,
        ].join(' · '),
      },
    );

  if (joinedTimestamp) {
    embed.addFields({ name: '📥 Miembro desde', value: `<t:${joinedTimestamp}:D> (<t:${joinedTimestamp}:R>)` });
  }

  embed.setFooter({ text: BRAND_NAME }).setTimestamp();
  return embed;
}

function buildPerfilRow(targetUserId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`perfil_stats_${targetUserId}`).setLabel('📊 Estadísticas').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`perfil_logros_${targetUserId}`).setLabel('🏅 Logros').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`perfil_inventario_${targetUserId}`).setLabel('🎒 Inventario').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('perfil_servidorlogros').setLabel('🏆 Logros del servidor').setStyle(ButtonStyle.Secondary),
    // Siempre son los recordatorios de quien CLICKEA, no los del perfil que se está
    // mirando — un recordatorio es privado, no algo que se pueda consultar de otro.
    new ButtonBuilder().setCustomId('perfil_recordatorios').setLabel('⏰ Mis recordatorios').setStyle(ButtonStyle.Secondary),
  );
}

async function buildStatsEmbed(guildId, targetUser) {
  const [xp, trivia, warns, wins] = await Promise.all([
    getUserXp(guildId, targetUser.id),
    getUserTrivia(guildId, targetUser.id),
    getUserWarns(guildId, targetUser.id),
    getUserWinCount(guildId, targetUser.id),
  ]);
  const progress = getLevelProgress(xp.xp);
  const accountCreated = Math.floor(targetUser.createdTimestamp / 1000);
  const ratio = trivia.answered > 0 ? Math.round((trivia.correct / trivia.answered) * 100) : 0;

  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`📊 Estadísticas de ${targetUser.tag}`)
    .addFields(
      { name: '⭐ Nivel', value: `${progress.level}`, inline: true },
      { name: '✨ XP total', value: `${progress.totalXp.toLocaleString('es-ES')}`, inline: true },
      { name: '🧠 Trivia', value: `${trivia.correct}/${trivia.answered} correctas (${ratio}%)`, inline: true },
      { name: '⚠️ Warns activos', value: `${warns.length}`, inline: true },
      { name: '🎉 Sorteos ganados', value: `${wins}`, inline: true },
      { name: '📅 Cuenta creada', value: `<t:${accountCreated}:D>`, inline: true },
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();
}

export const data = new SlashCommandBuilder()
  .setName('perfil')
  .setDescription(`Muestra tu perfil completo de ${BRAND_NAME} (o el de otro usuario).`)
  .addUserOption((o) => o.setName('usuario').setDescription('Usuario a consultar (opcional)').setRequired(false))
  .setDMPermission(false);

export async function execute(interaction) {
  const targetUser = interaction.options.getUser('usuario') || interaction.user;
  const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

  if (!member) {
    await interaction.reply({ content: '❌ No se pudo encontrar a ese usuario en este servidor.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply();

  const embed = await buildPerfilEmbed(interaction.guild, targetUser, member);
  await interaction.editReply({
    embeds: [embed],
    components: [buildPerfilRow(targetUser.id)],
  });
}

registerButtonPrefix('perfil_stats_', async (i) => {
  const targetUserId = i.customId.slice('perfil_stats_'.length);
  const targetUser = await i.client.users.fetch(targetUserId).catch(() => null);
  if (!targetUser) return i.reply({ content: '❌ No se pudo encontrar a ese usuario.', flags: MessageFlags.Ephemeral });
  const statsEmbed = await buildStatsEmbed(i.guild.id, targetUser);
  await i.reply({ embeds: [statsEmbed], flags: MessageFlags.Ephemeral });
});

registerButtonPrefix('perfil_logros_', async (i) => {
  const targetUserId = i.customId.slice('perfil_logros_'.length);
  const targetUser = await i.client.users.fetch(targetUserId).catch(() => null);
  if (!targetUser) return i.reply({ content: '❌ No se pudo encontrar a ese usuario.', flags: MessageFlags.Ephemeral });
  const unlockedIds = await getUnlockedAchievementIds(i.guildId, targetUserId);
  await i.reply({ embeds: [buildLogrosEmbed(targetUser, unlockedIds)], flags: MessageFlags.Ephemeral });
});

registerButtonPrefix('perfil_inventario_', async (i) => {
  const targetUserId = i.customId.slice('perfil_inventario_'.length);
  const targetUser = await i.client.users.fetch(targetUserId).catch(() => null);
  if (!targetUser) return i.reply({ content: '❌ No se pudo encontrar a ese usuario.', flags: MessageFlags.Ephemeral });
  const inventoryEmbed = await buildInventoryEmbed(i.guild.id, targetUser);
  await i.reply({ embeds: [inventoryEmbed], flags: MessageFlags.Ephemeral });
});

registerButtonPrefix('perfil_servidorlogros', async (i) => {
  const unlockedIds = await getUnlockedGuildAchievementIds(i.guildId);
  await i.reply({ embeds: [buildGuildLogrosEmbed(i.guild, unlockedIds)], flags: MessageFlags.Ephemeral });
});

registerButtonPrefix('perfil_recordatorios', async (i) => {
  const reminders = await getUserReminders(i.guildId, i.user.id);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('⏰ Tus recordatorios pendientes')
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();

  if (reminders.length === 0) {
    embed.setDescription('No tenés recordatorios pendientes. Creá uno con `/recordatorio crear`.');
  } else {
    // Un campo por recordatorio (mismo criterio que /warns) en vez de una sola
    // descripción con saltos de línea — más fácil de escanear si hay varios. Máximo
    // 25 (límite de campos de un embed) — con más, se avisa a usar /recordatorio listar.
    embed.addFields(
      reminders.slice(0, 25).map((r) => ({ name: `#${r.id} · <t:${Math.floor(r.remindAt / 1000)}:R>`, value: r.message.slice(0, 1024) })),
    );
    if (reminders.length > 25) {
      embed.setFooter({ text: `${BRAND_NAME} • Mostrando 25 de ${reminders.length} — usá /recordatorio listar para ver el resto` });
    }
  }

  await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
});
