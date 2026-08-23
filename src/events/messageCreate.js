import { Events } from 'discord.js';
import { grantMessageXp } from '../utils/xpStore.js';
import { processLevelUp } from '../utils/xpEngine.js';
import { getGuildConfig } from '../utils/guildConfigStore.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';
import { detectSecret } from '../utils/secretDetector.js';
import { createSecretLeakLogEmbed, createPunishFilterLogEmbed, createAntiSpamLogEmbed } from '../utils/logEmbeds.js';
import { getAfk, clearAfk } from '../utils/afkStore.js';
import { detectSpam, SPAM_REASON_LABELS } from '../utils/spamDetector.js';

const URL_REGEX = /https?:\/\/\S+|www\.\S+/i;
const SPAM_TIMEOUT_MS = 5 * 60 * 1000;

export const name = Events.MessageCreate;
export const once = false;

export async function execute(message, client) {
  try {
    if (message.author.bot) return;
    if (!message.guild) return;

    // --- PARTE 0: secretos/tokens expuestos (máxima prioridad, corta el resto) ---

    const secret = detectSecret(message.content);
    if (secret) {
      await message.delete().catch(() => {});

      // Best-effort: muchos usuarios tienen DMs cerrados, no bloqueamos el flujo por eso
      await message.author
        .send(`⚠️ Tu mensaje en **${message.guild.name}** se borró automáticamente porque parecía contener un secreto/token (${secret.type}). Si es real, revocalo/rotalo ya.`)
        .catch(() => {});

      const secretLogChannel = await getGuildLogChannel(client, message.guild.id, 'moderation');
      if (secretLogChannel) {
        await secretLogChannel.send({
          embeds: [createSecretLeakLogEmbed({ user: message.author, channel: message.channel, ...secret })],
        });
      }
      return;
    }

    const cfg = await getGuildConfig(message.guild.id);
    const member = message.member;

    // --- PARTE 1: AFK (independiente de qué features tenga activas el server) ---

    if (getAfk(message.guild.id, message.author.id)) {
      clearAfk(message.guild.id, message.author.id);
      await message.reply({ content: `👋 Bienvenido/a de vuelta ${message.author}, te quité el AFK.`, allowedMentions: { repliedUser: false } }).catch(() => {});
    }

    if (message.mentions.users.size > 0) {
      const afkMentions = [];
      for (const user of message.mentions.users.values()) {
        if (user.id === message.author.id) continue;
        const afk = getAfk(message.guild.id, user.id);
        if (afk) {
          // Timestamp nativo de Discord en vez de calcular "hace X min" a mano — se
          // traduce solo al idioma del cliente de quien lo lee, no queda fijo en español.
          afkMentions.push(`💤 ${user} está ausente (desde <t:${Math.floor(afk.since / 1000)}:R>): ${afk.reason}`);
        }
      }
      if (afkMentions.length > 0) {
        await message.reply({ content: afkMentions.join('\n'), allowedMentions: { repliedUser: false, users: [] } }).catch(() => {});
      }
    }

    // --- PARTE 2: auto-moderación de spam (flood, contenido repetido, menciones masivas) ---

    if (cfg.features?.moderacion && member) {
      const isStaffMember = Boolean(
        (cfg.admin_role_id && member.roles.cache.has(cfg.admin_role_id)) ||
          (cfg.moderator_role_id && member.roles.cache.has(cfg.moderator_role_id)),
      );

      const spamReason = isStaffMember ? null : detectSpam(message);
      if (spamReason) {
        await message.delete().catch(() => {});

        let timedOut = false;
        if (member.moderatable) {
          timedOut = await member
            .timeout(SPAM_TIMEOUT_MS, `Auto-moderación: ${SPAM_REASON_LABELS[spamReason]}`)
            .then(() => true)
            .catch(() => false);
        }

        if (timedOut) {
          await message.author
            .send(`⚠️ Se te aplicó un timeout de 5 minutos en **${message.guild.name}** por actividad de spam (${SPAM_REASON_LABELS[spamReason]}).`)
            .catch(() => {});
        }

        const spamLogChannel = await getGuildLogChannel(client, message.guild.id, 'moderation');
        if (spamLogChannel) {
          await spamLogChannel.send({
            embeds: [createAntiSpamLogEmbed({ user: message.author, channel: message.channel, reason: SPAM_REASON_LABELS[spamReason], timedOut })],
          });
        }

        return;
      }
    }

    // --- PARTE 3: XP por actividad ---

    if (cfg.features?.xp && member) {
      const result = await grantMessageXp(message.guild.id, message.author.id, message.content);
      if (result?.leveledUp) {
        await processLevelUp(
          member,
          { previousLevel: result.previousLevel, newLevel: result.newLevel, totalXp: result.record.xp },
          client,
        ).catch((error) => console.error('❌ Error procesando subida de nivel:', error));
      }
    }

    // --- PARTE 4: filtro de imágenes/enlaces para usuarios sancionados ---

    if (!cfg.punish_role_id) return;
    if (!member || !member.roles.cache.has(cfg.punish_role_id)) return;

    const hasAttachment = message.attachments.size > 0;
    const hasLink = URL_REGEX.test(message.content);
    if (!hasAttachment && !hasLink) return;

    await message.delete().catch(() => {});

    const filterLogChannel = await getGuildLogChannel(client, message.guild.id, 'moderation');
    if (filterLogChannel) {
      const reason = hasAttachment && hasLink ? 'Imagen y enlace' : hasAttachment ? 'Imagen/archivo' : 'Enlace';
      await filterLogChannel.send({
        embeds: [createPunishFilterLogEmbed({ user: message.author, channel: message.channel, reason })],
      });
    }
  } catch (error) {
    console.error('❌ Error en messageCreate:', error);
  }
}
