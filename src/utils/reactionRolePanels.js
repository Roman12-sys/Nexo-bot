// Reaction-roles (P1 de Fase 4B, evaluado y diferido a propósito hasta ahora — ver
// CLAUDE.md). Implementado como panel de botones, NO reacciones de emoji literales: el
// bot no tiene el intent GuildMessageReactions, y agregar reacciones-como-mecanismo
// hubiera significado un cambio de infra (intent + Partials.Reaction + un listener
// nuevo). Un botón por rol reusa el router ya existente (src/components/buttons.js) sin
// tocar nada de eso — mismo criterio que giveaway_enter_ (sorteo.js) y selfroles_select
// (selfRoles.js).
//
// A diferencia de selfassignable_roles (UNA lista plana por guild, ver selfRoles.js),
// acá cada guild puede tener VARIOS paneles independientes en canales distintos — por
// eso es una tabla (reaction_role_panels), no una columna más de guild_config.
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { supabase } from '../supabaseClient.js';
import { getDangerousRolePermission } from './permissions.js';
import { registerButtonPrefix } from '../components/buttons.js';
import { MAGENTA_COLOR, BRAND_NAME } from './embeds.js';

const TABLE = 'reaction_role_panels';
export const BUTTON_PREFIX = 'rr_toggle_';
// Un solo ActionRow de botones — 5 es el máximo real de Discord por fila. Sin
// paginación ni múltiples filas a propósito (mismo criterio que selfRoles.js con sus 25
// de un select): para más roles, el admin crea otro panel en otro mensaje/canal.
export const MAX_ROLES_PER_PANEL = 5;

function rowToPanel(row) {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    roles: row.roles || [],
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export async function createReactionRolePanel(guildId, channelId, messageId, roles, createdBy) {
  const { error } = await supabase
    .from(TABLE)
    .insert({ guild_id: guildId, channel_id: channelId, message_id: messageId, roles, created_by: createdBy });
  if (error) throw error;
}

export async function getReactionRolePanel(guildId, messageId) {
  const { data, error } = await supabase.from(TABLE).select('*').eq('guild_id', guildId).eq('message_id', messageId).maybeSingle();
  if (error) throw error;
  return data ? rowToPanel(data) : null;
}

export async function deleteReactionRolePanel(guildId, messageId) {
  const { error } = await supabase.from(TABLE).delete().eq('guild_id', guildId).eq('message_id', messageId);
  if (error) throw error;
}

export async function listReactionRolePanels(guildId) {
  const { data, error } = await supabase.from(TABLE).select('*').eq('guild_id', guildId).order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(rowToPanel);
}

// Única fuente de verdad de "¿NEXO puede asignar este rol ahora mismo?" — usada tanto al
// crear el panel (rechazar antes de postear nada) como en cada click (revalidar en vivo,
// mismo criterio que resolveLiveSelfRoles en selfRoles.js: un admin puede volver
// peligroso un rol, o bajar a NEXO de posición, DESPUÉS de crear el panel). Devuelve
// null si está todo bien, o un motivo en español listo para mostrar si no.
export function getRoleValidationError(guild, role) {
  const dangerous = getDangerousRolePermission(role);
  if (dangerous) return `tiene el permiso **${dangerous}**`;

  const me = guild.members.me;
  if (!me || !me.permissions.has(PermissionFlagsBits.ManageRoles) || me.roles.highest.position <= role.position) {
    return 'está en una posición igual o superior al rol más alto de NEXO (o al bot le falta "Gestionar roles")';
  }

  return null;
}

// { embeds, components } listos para .send()/.editReply() — reusado por
// /rolreacciones crear. roles: [{ roleId, label }], ya validados por el caller.
export function buildReactionRolePanelMessage({ titulo, descripcion, roles }) {
  const embed = new EmbedBuilder()
    .setColor(MAGENTA_COLOR)
    .setTitle(titulo || '🎭 Elegí tus roles')
    .setFooter({ text: BRAND_NAME });
  if (descripcion) embed.setDescription(descripcion);

  const row = new ActionRowBuilder().addComponents(
    roles.map((r) => new ButtonBuilder().setCustomId(`${BUTTON_PREFIX}${r.roleId}`).setLabel(r.label.slice(0, 80)).setStyle(ButtonStyle.Secondary)),
  );

  return { embeds: [embed], components: [row] };
}

// Único handler, sin importar cuál de los paneles de un guild se haya clickeado —
// mismo criterio que selfRoles.js: nunca confiar en los datos guardados por sí solos,
// se revalida todo en fresco contra el servidor real en cada click.
registerButtonPrefix(BUTTON_PREFIX, async (interaction) => {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const roleId = interaction.customId.slice(BUTTON_PREFIX.length);

    const panel = await getReactionRolePanel(interaction.guildId, interaction.message.id);
    if (!panel) {
      await interaction.editReply({ content: 'ℹ️ Este panel ya no es válido — puede que el staff lo haya eliminado.' });
      return;
    }
    if (!panel.roles.some((r) => r.roleId === roleId)) {
      await interaction.editReply({ content: '❌ Ese rol ya no forma parte de este panel.' });
      return;
    }

    const role = interaction.guild.roles.cache.get(roleId) || (await interaction.guild.roles.fetch(roleId).catch(() => null));
    if (!role) {
      await interaction.editReply({ content: '❌ Ese rol ya no existe en el servidor. Avisale al staff.' });
      return;
    }

    const validationError = getRoleValidationError(interaction.guild, role);
    if (validationError) {
      await interaction.editReply({ content: `❌ NEXO no puede asignar ${role} ahora mismo (${validationError}). Avisale al staff.` });
      return;
    }

    if (interaction.member.roles.cache.has(roleId)) {
      await interaction.member.roles.remove(roleId);
      await interaction.editReply({ content: `➖ Te saqué el rol ${role}.` });
    } else {
      await interaction.member.roles.add(roleId);
      await interaction.editReply({ content: `✅ Te di el rol ${role}.` });
    }
  } catch (error) {
    console.error('❌ Error en el toggle de un panel de reaction-roles:', error);
    await interaction.editReply({ content: '❌ No se pudo actualizar tu rol. Probá de nuevo o avisale al staff.' }).catch(() => {});
  }
});
