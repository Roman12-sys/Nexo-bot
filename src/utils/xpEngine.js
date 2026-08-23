// Lado "con acceso a Discord" del sistema de XP: procesa lo que pasa cuando alguien
// sube de nivel (roles automáticos, anuncio público, logs). xpStore.js en cambio es
// puro dato/fórmula, sin tocar la API de Discord.
import { EmbedBuilder } from 'discord.js';
import { BRAND_COLOR, BRAND_NAME } from './embeds.js';
import { getGuildConfig } from './guildConfigStore.js';
import { getGuildLogChannel } from './guildLogChannels.js';
import { createLevelUpLogEmbed, createLevelRoleAssignedLogEmbed, createLevelRoleErrorLogEmbed } from './logEmbeds.js';
import { unlockAchievement, buildAchievementUnlockedEmbed } from './achievements.js';

// Multiplicador de XP a nivel de servidor (guild_config.xp_weekend_boost) — vive acá y no
// en xpStore.js porque xpStore.js se mantiene deliberadamente sin depender de
// guild_config (ver su propio comentario de archivo). sábado/domingo en UTC, no en hora
// local del server de Discord (no hay forma de saber la zona horaria de una comunidad).
export function isWeekendUTC() {
  const day = new Date().getUTCDay();
  return day === 0 || day === 6;
}

export function getGuildXpMultiplier(cfg) {
  return cfg.xp_weekend_boost && isWeekendUTC() ? 2 : 1;
}

const LEVEL_ACHIEVEMENTS = [
  { level: 5, id: 'nivel_5' },
  { level: 10, id: 'nivel_10' },
  { level: 25, id: 'nivel_25' },
];

function buildLevelUpAnnounceEmbed({ member, newLevel, totalXp }) {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🎉 ¡SUBISTE DE NIVEL!')
    .setDescription(`${member} alcanzó el nivel **${newLevel}**.`)
    .addFields(
      { name: '⭐ Nuevo nivel', value: `${newLevel}`, inline: true },
      { name: '✨ XP', value: `${totalXp.toLocaleString('es-ES')}`, inline: true },
    )
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: `${BRAND_NAME} • ¡Seguí participando para alcanzar el próximo nivel!` })
    .setTimestamp();
}

// Asigna un único rol de nivel al miembro. Valida que el rol todavía exista y que el
// bot pueda asignarlo (jerarquía de roles) antes de intentarlo; nunca lanza — cualquier
// problema queda registrado en el canal de logs en vez de romper la subida de nivel.
async function assignLevelRole(member, level, roleId, logChannel) {
  const guild = member.guild;
  const role = guild.roles.cache.get(roleId);

  if (!role) {
    if (logChannel) {
      await logChannel.send({ embeds: [createLevelRoleErrorLogEmbed({ member, level, roleId, reason: 'El rol configurado ya no existe en el servidor.' })] });
    }
    return;
  }

  const botMember = guild.members.me;
  if (!botMember || role.position >= botMember.roles.highest.position) {
    if (logChannel) {
      await logChannel.send({ embeds: [createLevelRoleErrorLogEmbed({ member, level, roleId, reason: 'El rol está en una posición igual o superior al rol del bot — subilo en Ajustes del servidor.' })] });
    }
    return;
  }

  try {
    await member.roles.add(role);
    if (logChannel) {
      await logChannel.send({ embeds: [createLevelRoleAssignedLogEmbed({ member, role, level })] });
    }
  } catch (error) {
    console.error('❌ Error asignando rol de nivel:', error);
    if (logChannel) {
      await logChannel.send({ embeds: [createLevelRoleErrorLogEmbed({ member, level, roleId, reason: 'Error de permisos al intentar asignarlo.' })] });
    }
  }
}

// Se llama cada vez que grantMessageXp (o, más adelante, un comando de staff) hace
// subir de nivel a alguien. Recorre todos los niveles configurados (guild_config.level_roles)
// que quedaron entre el nivel anterior y el nuevo (por si subió varios de una sola vez) y:
//  1. en modo 'cumulative' (default): agrega el rol de CADA nivel cruzado, sin tocar
//     los que ya tenía de niveles anteriores.
//  2. en modo 'replace': solo se queda con el rol del nivel más alto cruzado, quitando
//     antes cualquier otro rol de nivel configurado (nunca toca roles ajenos a este sistema).
//  3. En ambos casos anuncia la subida (si hay canal configurado) y registra todo en logs.
export async function processLevelUp(member, { previousLevel, newLevel, totalXp }, client) {
  const guildId = member.guild.id;
  const cfg = await getGuildConfig(guildId);

  const logChannel = await getGuildLogChannel(client, guildId, 'activity');
  if (logChannel) {
    await logChannel.send({ embeds: [createLevelUpLogEmbed({ member, previousLevel, newLevel, totalXp })] });
  }

  const levelRoles = cfg.level_roles || {};
  const crossedLevels = [];
  for (let lvl = previousLevel + 1; lvl <= newLevel; lvl++) {
    if (levelRoles[lvl]) crossedLevels.push(lvl);
  }

  if (crossedLevels.length > 0) {
    if (cfg.level_roles_mode === 'replace') {
      const highestLevel = crossedLevels[crossedLevels.length - 1];
      const highestRoleId = levelRoles[highestLevel];
      const allLevelRoleIds = Object.values(levelRoles);
      const toRemove = member.roles.cache.filter((r) => allLevelRoleIds.includes(r.id) && r.id !== highestRoleId);

      if (toRemove.size > 0) {
        await member.roles.remove(toRemove).catch((error) => console.error('❌ Error quitando roles de nivel anteriores:', error));
      }
      await assignLevelRole(member, highestLevel, highestRoleId, logChannel);
    } else {
      for (const lvl of crossedLevels) {
        await assignLevelRole(member, lvl, levelRoles[lvl], logChannel);
      }
    }
  }

  let announceChannel = null;
  if (cfg.xp_announce_channel_id) {
    announceChannel = await client.channels.fetch(cfg.xp_announce_channel_id).catch(() => null);
    if (announceChannel?.isTextBased()) {
      await announceChannel.send({ embeds: [buildLevelUpAnnounceEmbed({ member, newLevel, totalXp })] }).catch(() => {});
    }
  }

  // Los 3 hitos de nivel son el único logro que se evalúa fuera de un comando (la
  // subida de nivel pasa tanto por actividad en el chat como por /xp de staff) —
  // se anuncia en el canal de anuncio de XP si hay uno configurado, si no en el de
  // logs de actividad; si no hay ninguno de los dos, queda desbloqueado en silencio
  // (igual visible después en /perfil → Logros).
  const celebrationChannel = announceChannel?.isTextBased() ? announceChannel : logChannel;
  for (const { level, id } of LEVEL_ACHIEVEMENTS) {
    if (previousLevel < level && newLevel >= level) {
      const achievement = await unlockAchievement(guildId, member.id, id);
      if (achievement && celebrationChannel) {
        await celebrationChannel.send({ embeds: [buildAchievementUnlockedEmbed(member.user, achievement)] }).catch(() => {});
      }
    }
  }
}
