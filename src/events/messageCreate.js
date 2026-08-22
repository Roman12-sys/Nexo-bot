import { Events } from 'discord.js';
import { grantMessageXp } from '../utils/xpStore.js';
import { processLevelUp } from '../utils/xpEngine.js';
import { getGuildConfig } from '../utils/guildConfigStore.js';

export const name = Events.MessageCreate;
export const once = false;

export async function execute(message, client) {
  try {
    if (message.author.bot) return;
    if (!message.guild) return;

    const cfg = await getGuildConfig(message.guild.id);
    if (!cfg.features?.xp) return;

    const member = message.member;
    if (!member) return;

    const result = await grantMessageXp(message.guild.id, message.author.id, message.content);
    if (result?.leveledUp) {
      await processLevelUp(
        member,
        { previousLevel: result.previousLevel, newLevel: result.newLevel, totalXp: result.record.xp },
        client,
      ).catch((error) => console.error('❌ Error procesando subida de nivel:', error));
    }
  } catch (error) {
    console.error('❌ Error en messageCreate:', error);
  }
}
