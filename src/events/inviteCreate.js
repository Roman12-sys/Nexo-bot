import { Events } from 'discord.js';
import { createInviteLogEmbed } from '../utils/logEmbeds.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';

export const name = Events.InviteCreate;
export const once = false;

export async function execute(invite, client) {
  if (!invite.guild) return;

  try {
    const logChannel = await getGuildLogChannel(client, invite.guild.id, 'activity');
    if (!logChannel) return;

    await logChannel.send({ embeds: [createInviteLogEmbed({ action: 'create', invite })] });
  } catch (error) {
    console.error('❌ Error registrando la creación de una invite:', error);
  }
}
