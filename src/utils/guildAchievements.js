// Logros colectivos del servidor entero — a diferencia de achievements.js (por usuario),
// acá no hay owner: se desbloquean una sola vez para todo el guild y se anuncian en el
// canal de logs de actividad configurado (si hay uno). Esta tabla de definiciones es la
// única fuente de verdad; guild_achievements_unlocked en Supabase solo guarda CUÁLES ya
// se desbloquearon.
import { EmbedBuilder } from 'discord.js';
import { supabase } from '../supabaseClient.js';
import { BRAND_COLOR, BRAND_NAME } from './embeds.js';
import { getGuildLogChannel } from './guildLogChannels.js';

const TABLE = 'guild_achievements_unlocked';

export const GUILD_ACHIEVEMENTS = [
  { id: 'comunidad_50', emoji: '🌱', name: 'Comunidad en crecimiento', description: 'El servidor alcanzó 50 miembros.' },
  { id: 'comunidad_100', emoji: '🌳', name: 'Comunidad establecida', description: 'El servidor alcanzó 100 miembros.' },
  { id: 'comunidad_250', emoji: '🏙️', name: 'Comunidad grande', description: 'El servidor alcanzó 250 miembros.' },
  { id: 'activos_100', emoji: '⚡', name: 'Recién empezando', description: 'Se ejecutaron 100 comandos en el servidor.' },
  { id: 'activos_1000', emoji: '🔥', name: 'Comunidad activa', description: 'Se ejecutaron 1.000 comandos en el servidor.' },
  { id: 'activos_5000', emoji: '🚀', name: 'Imparable', description: 'Se ejecutaron 5.000 comandos en el servidor.' },
];

const BY_ID = new Map(GUILD_ACHIEVEMENTS.map((a) => [a.id, a]));

const MEMBER_THRESHOLDS = [
  { min: 50, id: 'comunidad_50' },
  { min: 100, id: 'comunidad_100' },
  { min: 250, id: 'comunidad_250' },
];

const COMMAND_THRESHOLDS = [
  { min: 100, id: 'activos_100' },
  { min: 1000, id: 'activos_1000' },
  { min: 5000, id: 'activos_5000' },
];

// Inserta el desbloqueo si no existía (primary key compuesta hace de guarda contra
// duplicados). Devuelve el logro si se acaba de desbloquear recién ahora, o null si ya
// estaba — mismo patrón que unlockAchievement() en achievements.js.
async function unlockGuildAchievement(guildId, achievementId) {
  const achievement = BY_ID.get(achievementId);
  if (!achievement) throw new Error(`Logro de servidor desconocido: ${achievementId}`);

  const { error } = await supabase.from(TABLE).insert({ guild_id: guildId, achievement_id: achievementId });
  if (error) {
    if (error.code === '23505') return null; // unique_violation: ya estaba desbloqueado
    throw error;
  }
  return achievement;
}

export async function getUnlockedGuildAchievementIds(guildId) {
  const { data, error } = await supabase.from(TABLE).select('achievement_id').eq('guild_id', guildId);
  if (error) throw error;
  return new Set((data || []).map((row) => row.achievement_id));
}

async function announceGuildAchievement(client, guildId, achievement) {
  const channel = await getGuildLogChannel(client, guildId, 'activity');
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🏆 ¡Logro de servidor desbloqueado!')
    .setDescription(`${achievement.emoji} **${achievement.name}**\n${achievement.description}`)
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => {});
}

// value es el total actual (miembros o comandos ejecutados) — se recorren TODOS los
// umbrales que ya alcanzó, no solo el más alto, así un salto grande (ej: importar
// miembros) no se salta logros intermedios.
async function checkThresholds(client, guildId, value, thresholds) {
  for (const { min, id } of thresholds) {
    if (value < min) continue;
    const achievement = await unlockGuildAchievement(guildId, id).catch((error) => {
      console.error(`❌ Error desbloqueando logro de servidor "${id}":`, error);
      return null;
    });
    if (achievement) await announceGuildAchievement(client, guildId, achievement);
  }
}

export function checkMemberCountAchievements(client, guildId, memberCount) {
  return checkThresholds(client, guildId, memberCount, MEMBER_THRESHOLDS);
}

export function checkCommandUsageAchievements(client, guildId, totalCommandUsage) {
  return checkThresholds(client, guildId, totalCommandUsage, COMMAND_THRESHOLDS);
}

export function buildGuildLogrosEmbed(guild, unlockedIds) {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`🏆 Logros de ${guild.name}`)
    .setFooter({ text: `${BRAND_NAME} • ${unlockedIds.size}/${GUILD_ACHIEVEMENTS.length} desbloqueados` })
    .setTimestamp();

  embed.setDescription(
    GUILD_ACHIEVEMENTS.map((a) => {
      const unlocked = unlockedIds.has(a.id);
      return unlocked ? `${a.emoji} **${a.name}** — ${a.description}` : `🔒 *${a.name}* — ${a.description}`;
    }).join('\n'),
  );

  return embed;
}
