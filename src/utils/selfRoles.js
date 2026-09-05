// Roles autoasignables (CICLO 1, Mejora 2/2 — experiencia del miembro). Un miembro
// elige sus propios roles de una lista que el staff whitelisteó con /config
// rol-autoasignable-agregar/quitar — sin reaction roles, sin comando nuevo dedicado:
// el mismo menú se ofrece desde el mensaje de bienvenida (guildMemberAdd.js) y desde
// /help ("🎭 Mis roles"), ambos reusando exactamente este módulo.
import { StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { getGuildConfig } from './guildConfigStore.js';
import { getDangerousRolePermission } from './permissions.js';
import { registerSelectPrefix } from '../components/selects.js';

const SELECT_CUSTOM_ID = 'selfroles_select';

// Única fuente de verdad de "qué roles autoasignables están REALMENTE disponibles ahora
// mismo" — nunca los IDs crudos de guild_config tal cual: cada uno se revalida contra
// el servidor real. Se descartan en silencio (no es un error, es esperable con el
// tiempo): roles borrados, roles que ahora tienen un permiso peligroso (misma política
// que /setup y /config ya aplican a rol-automático/rol-castigo — defensa en profundidad,
// por si alguien le suma un permiso a un rol ya whitelisteado por fuera de NEXO), y
// roles en o por encima del rol más alto del bot (no los podría asignar de todas formas).
// Se llama tanto al construir el menú como al procesar cada click — nunca se confía en
// que la lista siga siendo válida entre un momento y el otro.
export async function resolveLiveSelfRoles(guild) {
  const cfg = await getGuildConfig(guild.id);
  const ids = cfg.selfassignable_roles || [];
  if (ids.length === 0) return [];

  const me = guild.members.me;
  if (!me) return []; // no se puede verificar jerarquía/permisos del bot — no ofrecer nada antes que arriesgar

  const roles = [];
  for (const id of ids) {
    const role = guild.roles.cache.get(id) || (await guild.roles.fetch(id).catch(() => null));
    if (!role) continue;
    if (getDangerousRolePermission(role)) continue;
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) continue;
    if (me.roles.highest.position <= role.position) continue;
    roles.push(role);
  }
  return roles;
}

// null si no hay ningún rol disponible de verdad — el caller nunca debe mandar/mostrar
// un menú vacío. `member` es opcional (para pre-marcar lo que ya tiene con .setDefault);
// sin él, el menú arranca sin nada preseleccionado.
export async function buildSelfRolesMessage(guild, member = null) {
  const roles = await resolveLiveSelfRoles(guild);
  if (roles.length === 0) return null;

  const menu = new StringSelectMenuBuilder()
    .setCustomId(SELECT_CUSTOM_ID)
    .setPlaceholder('Elegí tus roles (podés no elegir ninguno)')
    .setMinValues(0)
    .setMaxValues(roles.length)
    .addOptions(
      roles.map((r) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(r.name.slice(0, 100))
          .setValue(r.id)
          .setDefault(member ? member.roles.cache.has(r.id) : false),
      ),
    );

  return {
    content: '🎭 Elegí los roles que quieras tener — podés cambiarlos cuando quieras volviendo a abrir este menú.',
    components: [new ActionRowBuilder().addComponents(menu)],
  };
}

function describeRoleChanges(added, removed) {
  const parts = [];
  if (added.length > 0) parts.push(`✅ Agregado: ${added.map((r) => r.name).join(', ')}`);
  if (removed.length > 0) parts.push(`➖ Quitado: ${removed.map((r) => r.name).join(', ')}`);
  if (parts.length === 0) parts.push('Sin cambios — ya tenías exactamente esa combinación.');
  return parts.join('\n');
}

// Único handler, reusado sin importar desde dónde se abrió el menú (bienvenida o
// /help) — mismo criterio en toda esta feature: un solo camino, nunca dos sistemas que
// hacen lo mismo. Ephemeral: es una acción personal, no hace falta que se vea en el canal.
registerSelectPrefix(SELECT_CUSTOM_ID, async (interaction) => {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Nunca se confía en los `values` por sí solos como "roles válidos" — Discord los
    // limita a las opciones que este mismo menú ofreció, pero esas opciones pueden haber
    // quedado desactualizadas si un admin sacó un rol de la lista (o le agregó un permiso
    // peligroso) DESPUÉS de que este mensaje se mandara. Se revalida fresco acá.
    const liveRoles = await resolveLiveSelfRoles(interaction.guild);
    if (liveRoles.length === 0) {
      await interaction.editReply({ content: 'ℹ️ Ya no hay roles autoasignables configurados en este servidor.' });
      return;
    }

    const liveRoleIds = new Set(liveRoles.map((r) => r.id));
    const selected = new Set(interaction.values.filter((id) => liveRoleIds.has(id)));

    const toAdd = [];
    const toRemove = [];
    for (const role of liveRoles) {
      const wantsIt = selected.has(role.id);
      const hasIt = interaction.member.roles.cache.has(role.id);
      if (wantsIt === hasIt) continue;
      if (wantsIt) toAdd.push(role);
      else toRemove.push(role);
    }

    if (toAdd.length > 0) await interaction.member.roles.add(toAdd);
    if (toRemove.length > 0) await interaction.member.roles.remove(toRemove);

    await interaction.editReply({ content: describeRoleChanges(toAdd, toRemove) });
  } catch (error) {
    console.error('❌ Error asignando roles autoasignables:', error);
    await interaction.editReply({ content: '❌ No se pudieron actualizar tus roles. Probá de nuevo o avisale al staff.' }).catch(() => {});
  }
});
