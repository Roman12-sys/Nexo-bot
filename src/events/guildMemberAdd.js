import { Events, AuditLogEvent, EmbedBuilder } from 'discord.js';
import { createBotAddedLogEmbed } from '../utils/logEmbeds.js';
import { findExecutor } from '../utils/auditLog.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';
import { getGuildConfig } from '../utils/guildConfigStore.js';
import { buildWelcomeImageAttachment } from '../utils/welcomeImage.js';
import { BRAND_COLOR } from '../utils/embeds.js';
import { checkMemberCountAchievements } from '../utils/guildAchievements.js';

export const name = Events.GuildMemberAdd;
export const once = false;

// Le asigna el rol automático configurado (guild_config.auto_role_id, vía /config
// rol-automatico) a cada miembro nuevo. No corta el flujo de bienvenida si falla: un
// rol mal configurado no debería impedir el resto de guildMemberAdd (mensaje de bienvenida).
async function assignAutoRole(member, autoRoleId) {
  if (!autoRoleId) return;

  try {
    const role = member.guild.roles.cache.get(autoRoleId) || (await member.guild.roles.fetch(autoRoleId).catch(() => null));
    if (!role) {
      console.warn('⚠️ El rol automático configurado ya no existe en el servidor.');
      return;
    }

    const botMember = await member.guild.members.fetchMe();
    if (!botMember.permissions.has('ManageRoles')) {
      console.warn('⚠️ No se pudo asignar el rol automático: al bot le falta el permiso "Gestionar roles".');
      return;
    }
    if (botMember.roles.highest.position <= role.position) {
      console.warn(`⚠️ No se pudo asignar el rol automático "${role.name}": está en una posición igual o superior al rol más alto del bot.`);
      return;
    }

    await member.roles.add(role);
  } catch (error) {
    console.error('❌ Error asignando el rol automático a un miembro nuevo:', error);
  }
}

async function logBotAdded(member, client) {
  const logChannel = await getGuildLogChannel(client, member.guild.id, 'activity');
  if (!logChannel) return;

  const entry = await findExecutor(member.guild, { type: AuditLogEvent.BotAdd, targetId: member.id });

  await logChannel.send({
    embeds: [createBotAddedLogEmbed({ bot: member.user, executor: entry?.executor || null })],
  });
}

export async function execute(member, client) {
  // Los bots no reciben el embed de bienvenida de la comunidad; en su lugar
  // van directo al canal de logs de actividad (quién lo agregó).
  if (member.user.bot) {
    await logBotAdded(member, client).catch((error) => console.error('❌ Error registrando bot agregado:', error));
    return;
  }

  const cfg = await getGuildConfig(member.guild.id);

  await assignAutoRole(member, cfg.auto_role_id);

  checkMemberCountAchievements(client, member.guild.id, member.guild.memberCount).catch((error) =>
    console.error('❌ Error chequeando logros de servidor (miembros):', error),
  );

  if (!cfg.welcome_channel_id) return;

  try {
    const channel = await member.guild.channels.fetch(cfg.welcome_channel_id).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      console.warn('⚠️ No se pudo encontrar o acceder al canal de bienvenida configurado.');
      return;
    }

    const attachment = await buildWelcomeImageAttachment(member);
    const embed = new EmbedBuilder().setColor(BRAND_COLOR).setImage('attachment://welcome.png');

    await channel.send({
      content: `${member}`,
      embeds: [embed],
      files: [attachment],
      allowedMentions: { users: [member.id] },
    });
  } catch (error) {
    console.error('❌ Error enviando el mensaje de bienvenida:', error);
  }
}
