import { Events } from 'discord.js';
import { grantMessageXp } from '../utils/xpStore.js';
import { processLevelUp } from '../utils/xpEngine.js';
import { getGuildConfig } from '../utils/guildConfigStore.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';
import { detectSecret } from '../utils/secretDetector.js';
import { createSecretLeakLogEmbed, createPunishFilterLogEmbed } from '../utils/logEmbeds.js';

const URL_REGEX = /https?:\/\/\S+|www\.\S+/i;

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

    // --- PARTE 1: XP por actividad ---

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

    // --- PARTE 2: filtro de imágenes/enlaces para usuarios sancionados ---

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
