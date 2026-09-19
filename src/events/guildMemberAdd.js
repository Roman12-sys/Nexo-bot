import { Events, AuditLogEvent, EmbedBuilder } from 'discord.js';
import { createBotAddedLogEmbed, createPunishLogEmbed } from '../utils/logEmbeds.js';
import { findExecutor } from '../utils/auditLog.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';
import { getGuildConfig } from '../utils/guildConfigStore.js';
import { getDangerousRolePermission } from '../utils/permissions.js';
import { buildWelcomeEmbed, contextFromMember } from '../utils/welcomeEmbed.js';
import { buildSelfRolesMessage } from '../utils/selfRoles.js';
import { LOG_COLOR } from '../utils/embeds.js';
import { checkMemberCountAchievements } from '../utils/guildAchievements.js';
import { eventBus } from '../utils/eventBus.js'; // Event Engine — auditoría 2026-08-29, Fase 5 (analytics)
import { getActivePunishment } from '../utils/punishStore.js';
import { recordModerationAction } from '../utils/moderationActionsStore.js';

export const name = Events.GuildMemberAdd;
export const once = false;

// RIESGO ARQUITECTÓNICO (auditoría intensa 2026-09-12, cerrado 2026-09-15): a diferencia
// de "el rol ya no existe" (deriva operativa mundana, solo console.warn), un rol que se
// volvió peligroso DESPUÉS de configurado es información que el staff necesita ver — su
// config derivó a algo riesgoso sin que nadie lo pidiera. Reusado por assignAutoRole y
// reapplyActivePunishment, para que las dos únicas asignaciones automáticas de rol
// (sin revisión humana caso por caso) avisen igual.
async function warnDangerousRoleApply(client, guild, role, dangerousPermission, context) {
  console.warn(`⚠️ ${context}: el rol "${role.name}" tiene el permiso peligroso "${dangerousPermission}" (revalidado al aplicar) — asignación bloqueada.`);
  try {
    const logChannel = await getGuildLogChannel(client, guild.id, 'moderation');
    if (logChannel) {
      const embed = new EmbedBuilder()
        .setColor(LOG_COLOR)
        .setTitle('⚠️ Rol peligroso — asignación automática bloqueada')
        .setDescription(`${context}, pero el rol ${role} ahora tiene el permiso **${dangerousPermission}**. NEXO rechazó asignarlo para evitar una escalada de privilegios.`)
        .addFields({ name: 'Qué hacer', value: 'Quitale ese permiso al rol desde Discord, o reconfigurá el campo correspondiente con `/config`.' })
        .setTimestamp();
      await logChannel.send({ embeds: [embed] });
    }
  } catch (logError) {
    console.error('⚠️ No se pudo registrar el bloqueo de rol peligroso en el canal de logs:', logError);
  }
}

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

    const dangerousPermission = getDangerousRolePermission(role);
    if (dangerousPermission) {
      await warnDangerousRoleApply(member.client, member.guild, role, dangerousPermission, `Se iba a asignar el rol automático a ${member.user.tag}`);
      return;
    }

    await member.roles.add(role);
  } catch (error) {
    console.error('❌ Error asignando el rol automático a un miembro nuevo:', error);
  }
}

// MOD-2 (auditoría completa NEXO, 2026-09-11): antes de este fix, /punish se evadía
// por completo saliendo y reentrando al servidor — Discord quita todos los roles al
// salir (nativo de la plataforma), y nada volvía a aplicar la restricción. Ahora
// active_punishments guarda SIEMPRE una fila (ver punish.js/punishStore.js), así que
// acá alcanza con consultarla y, si sigue vigente, reaplicar el rol — mismo criterio
// que assignAutoRole: nunca corta el resto del flujo de bienvenida si algo falla.
async function reapplyActivePunishment(member, client) {
  try {
    const punishment = await getActivePunishment(member.guild.id, member.id);
    if (!punishment) return;
    // expiresAt null = indefinida (siempre vigente hasta /unpunish). Si tiene
    // duración, puede haber vencido mientras el usuario estaba afuera — el timer de
    // punishEngine.js ya se habrá encargado de borrar la fila en ese caso, pero esto
    // cierra la ventana rara de un timer todavía no disparado justo al reingresar.
    if (punishment.expiresAt != null && punishment.expiresAt <= Date.now()) return;

    const role = member.guild.roles.cache.get(punishment.roleId);
    if (!role) {
      console.warn('⚠️ No se pudo reaplicar la restricción de /punish: el rol configurado ya no existe.');
      return;
    }

    const dangerousPermission = getDangerousRolePermission(role);
    if (dangerousPermission) {
      await warnDangerousRoleApply(client, member.guild, role, dangerousPermission, `Se iba a reaplicar la restricción de /punish a ${member.user.tag} tras reingresar`);
      return;
    }

    await member.roles.add(punishment.roleId, 'Restricción de /punish reaplicada tras reingreso al servidor');

    const reason = 'Reaplicada automáticamente: seguía activa cuando el usuario reingresó al servidor.';
    try {
      const logChannel = await getGuildLogChannel(client, member.guild.id, 'moderation');
      if (logChannel) {
        await logChannel.send({ embeds: [createPunishLogEmbed({ user: member.user, executor: client.user, reason, applied: true })] });
      }
    } catch (logError) {
      console.error('⚠️ No se pudo registrar la reaplicación de /punish en el canal de logs:', logError);
    }

    await recordModerationAction(member.guild.id, member.id, {
      actionType: 'punish_reapply',
      moderatorId: client.user.id,
      reason,
    }).catch((error) => console.error('⚠️ No se pudo registrar la reaplicación de /punish en el historial:', error));
  } catch (error) {
    console.error('❌ Error reaplicando una restricción de /punish al reingresar:', error);
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

  eventBus.emit('MEMBER_JOINED', { guildId: member.guild.id }).catch(() => {});

  await assignAutoRole(member, cfg.auto_role_id);
  await reapplyActivePunishment(member, client);

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

    // NEXO Setup Inteligente (Bloque 11): el embed de bienvenida reemplaza el enfoque
    // anterior basado en imagen (@napi-rs/canvas, welcomeImage.js) — texto + color +
    // footer 100% personalizables desde /setup (welcome_title/welcome_description/
    // welcome_color/welcome_footer en guild_config, todos nullable: null = el texto de
    // ejemplo de siempre). welcomeImage.js no se borró — rankCardImage.js sigue
    // dependiendo de la misma infraestructura de canvas/fuentes — solo dejó de ser el
    // camino por defecto acá.
    const embed = buildWelcomeEmbed(cfg, contextFromMember(member));

    // El menú de roles autoasignables es opcional a propósito: si el server no
    // configuró ninguno (o todos quedaron inválidos, ver resolveLiveSelfRoles), esto es
    // null y el mensaje se manda exactamente igual que antes — no exige configurar nada
    // nuevo para seguir recibiendo la bienvenida de siempre.
    const selfRolesMessage = await buildSelfRolesMessage(member.guild, member, cfg);
    if (selfRolesMessage) embed.addFields({ name: '🎭 ¿Querés elegir un rol?', value: selfRolesMessage.content });

    await channel.send({
      content: `${member}`,
      embeds: [embed],
      components: selfRolesMessage?.components || [],
      allowedMentions: { users: [member.id] },
    });
  } catch (error) {
    console.error('❌ Error enviando el mensaje de bienvenida:', error);
  }
}
