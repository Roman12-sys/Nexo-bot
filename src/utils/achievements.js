// Sistema de logros: set FIJO definido acá (no configurable por servidor, a
// diferencia de la tienda — son cosméticos, no vale la pena la superficie de admin).
// Esta tabla de definiciones es la única fuente de verdad; achievements_unlocked en
// Supabase solo guarda CUÁLES desbloqueó cada usuario.
import { EmbedBuilder } from 'discord.js';
import { supabase } from '../supabaseClient.js';
import { BRAND_COLOR, BRAND_NAME } from './embeds.js';

const TABLE = 'achievements_unlocked';

export const ACHIEVEMENTS = [
  { id: 'primera_moneda', emoji: '🪙', name: 'Primeros pasos', description: 'Reclamaste tu primer /daily.' },
  { id: 'a_laburar', emoji: '💼', name: 'A laburar', description: 'Reclamaste tu primer /work.' },
  { id: 'millonario', emoji: '💰', name: 'Millonario', description: 'Alcanzaste 10.000 monedas de balance.' },
  { id: 'nivel_5', emoji: '⭐', name: 'En marcha', description: 'Llegaste al nivel 5.' },
  { id: 'nivel_10', emoji: '🌟', name: 'Veterano', description: 'Llegaste al nivel 10.' },
  { id: 'nivel_25', emoji: '💫', name: 'Leyenda', description: 'Llegaste al nivel 25.' },
  { id: 'sabelotodo', emoji: '🧠', name: 'Sabelotodo', description: 'Acumulaste 10 respuestas correctas en /trivia.' },
  { id: 'racha_perfecta', emoji: '🎯', name: 'Racha perfecta', description: 'Adivinaste el número de /guess al primer intento.' },
  { id: 'querido', emoji: '❤️', name: 'Querido por la comunidad', description: 'Llegaste a 10 puntos de reputación.' },
  { id: 'con_suerte', emoji: '🎉', name: 'Con suerte', description: 'Ganaste un /sorteo.' },
  { id: 'anfitrion', emoji: '🔊', name: 'Anfitrión', description: 'Creaste tu primera sala de voz temporal.' },
  { id: 'primera_compra', emoji: '🛍️', name: 'De compras', description: 'Compraste tu primer ítem en /shop.' },
  { id: 'primera_encuesta', emoji: '📊', name: 'Encuestador', description: 'Creaste tu primera /encuesta.' },
  { id: 'primera_confesion', emoji: '🤫', name: 'Confesor anónimo', description: 'Enviaste tu primera /confession.' },
];

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

// Inserta el desbloqueo si no existía (primary key compuesta hace de guarda contra
// duplicados). Devuelve el logro si se acaba de desbloquear recién ahora, o null si
// ya lo tenía — así el caller solo anuncia el logro la primera vez, nunca de nuevo en
// cada chequeo posterior (ej. millonario se re-evalúa en cada /daily).
export async function unlockAchievement(guildId, userId, achievementId) {
  const achievement = BY_ID.get(achievementId);
  if (!achievement) throw new Error(`Logro desconocido: ${achievementId}`);

  const { error } = await supabase
    .from(TABLE)
    .insert({ guild_id: guildId, user_id: userId, achievement_id: achievementId });

  if (error) {
    if (error.code === '23505') return null; // unique_violation: ya lo tenía
    throw error;
  }
  return achievement;
}

export async function getUnlockedAchievementIds(guildId, userId) {
  const { data, error } = await supabase.from(TABLE).select('achievement_id').eq('guild_id', guildId).eq('user_id', userId);
  if (error) throw error;
  return new Set((data || []).map((row) => row.achievement_id));
}

// Resuelve una lista de chequeos de logro (promesas de unlockAchievement, algunas
// `null` si no aplicaba) y manda un followUp por cada uno que se acaba de desbloquear
// recién ahora. Pensado para comandos que ya respondieron con su embed principal y
// quieren anunciar el logro aparte, sin bloquear esa respuesta con el chequeo.
export async function announceUnlockedAchievements(interaction, userId, achievementChecks) {
  const results = await Promise.all(achievementChecks);
  for (const achievement of results) {
    if (!achievement) continue;
    await interaction
      .followUp({ content: `<@${userId}> desbloqueó ${achievement.emoji} **${achievement.name}** — ${achievement.description}` })
      .catch(() => {});
  }
}

// Embed completo, para cuando SÍ hace falta un mensaje propio (sorteos, salas de voz —
// no hay una "respuesta de comando" natural donde meter una línea extra).
export function buildAchievementUnlockedEmbed(user, achievement) {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🏅 ¡Logro desbloqueado!')
    .setDescription(`${user} consiguió **${achievement.emoji} ${achievement.name}**\n${achievement.description}`)
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();
}

export function buildLogrosEmbed(targetUser, unlockedIds) {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`🏅 Logros de ${targetUser.tag}`)
    .setFooter({ text: `${BRAND_NAME} • ${unlockedIds.size}/${ACHIEVEMENTS.length} desbloqueados` })
    .setTimestamp();

  embed.setDescription(
    ACHIEVEMENTS.map((a) => {
      const unlocked = unlockedIds.has(a.id);
      return unlocked ? `${a.emoji} **${a.name}** — ${a.description}` : `🔒 *${a.name}* — ${a.description}`;
    }).join('\n'),
  );

  return embed;
}
