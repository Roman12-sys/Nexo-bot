// Reaction-roles (P1 de Fase 4B, evaluado y diferido a propósito — ver CLAUDE.md).
// Panel de botones, no reacciones de emoji literales (ver src/utils/reactionRolePanels.js
// para el porqué). Mismo tier que /config (dueño del servidor o Administrator nativo,
// no isAdmin()): crea un mensaje permanente + una fila de config, igual que el resto de
// comandos que tocan roles/canales de guild_config.
import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, MessageFlags } from 'discord.js';
import { logConfigChange } from './config.js';
import {
  createReactionRolePanel,
  deleteReactionRolePanel,
  listReactionRolePanels,
  getReactionRolePanel,
  getRoleValidationError,
  buildReactionRolePanelMessage,
} from '../../utils/reactionRolePanels.js';
import { BRAND_COLOR, NEUTRAL_COLOR, BRAND_NAME } from '../../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('rolreacciones')
  .setDescription('Paneles de botones para que los miembros elijan roles solos.')
  .addSubcommand((sub) =>
    sub
      .setName('crear')
      .setDescription('Crea un panel nuevo con hasta 5 roles.')
      .addRoleOption((o) => o.setName('rol1').setDescription('Primer rol').setRequired(true))
      .addRoleOption((o) => o.setName('rol2').setDescription('Segundo rol').setRequired(false))
      .addRoleOption((o) => o.setName('rol3').setDescription('Tercer rol').setRequired(false))
      .addRoleOption((o) => o.setName('rol4').setDescription('Cuarto rol').setRequired(false))
      .addRoleOption((o) => o.setName('rol5').setDescription('Quinto rol').setRequired(false))
      .addChannelOption((o) =>
        o.setName('canal').setDescription('Canal donde postear el panel (por defecto: este canal)').addChannelTypes(ChannelType.GuildText).setRequired(false),
      )
      .addStringOption((o) => o.setName('titulo').setDescription('Título del panel (por defecto: "Elegí tus roles")').setRequired(false).setMaxLength(256))
      .addStringOption((o) => o.setName('descripcion').setDescription('Texto opcional debajo del título').setRequired(false).setMaxLength(1024)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('eliminar')
      .setDescription('Elimina un panel de reaction-roles ya creado.')
      .addStringOption((o) => o.setName('mensaje_id').setDescription('ID del mensaje del panel').setRequired(true)),
  )
  .addSubcommand((sub) => sub.setName('listar').setDescription('Muestra los paneles de reaction-roles activos en este servidor.'))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

async function handleCrear(interaction) {
  const roleOptions = ['rol1', 'rol2', 'rol3', 'rol4', 'rol5'].map((name) => interaction.options.getRole(name)).filter(Boolean);

  const seen = new Set();
  const roles = [];
  for (const rol of roleOptions) {
    if (seen.has(rol.id)) continue;
    seen.add(rol.id);
    roles.push(rol);
  }

  for (const rol of roles) {
    const validationError = getRoleValidationError(interaction.guild, rol);
    if (validationError) {
      await interaction.reply({
        content: `❌ ${rol} ${validationError} — no se puede usar en un panel de reaction-roles. Elegí (o creá) otro rol.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  const canal = interaction.options.getChannel('canal') || interaction.channel;
  const titulo = interaction.options.getString('titulo');
  const descripcion = interaction.options.getString('descripcion');

  const panelRoles = roles.map((r) => ({ roleId: r.id, label: r.name }));
  const { embeds, components } = buildReactionRolePanelMessage({ titulo, descripcion, roles: panelRoles });

  let message;
  try {
    message = await canal.send({ embeds, components });
  } catch (error) {
    console.error('❌ Error posteando el panel de reaction-roles:', error);
    await interaction.reply({
      content: `❌ No pude postear el panel en ${canal} — revisá que NEXO tenga permiso para escribir ahí.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await createReactionRolePanel(interaction.guildId, canal.id, message.id, panelRoles, interaction.user.id);

  await interaction.reply({ content: `✅ Panel creado en ${canal} con ${roles.length} rol(es): ${message.url}`, flags: MessageFlags.Ephemeral });
  await logConfigChange(interaction, `🎭 Panel de reaction-roles creado en ${canal} (${roles.length} rol(es))`);
}

async function handleEliminar(interaction) {
  const messageId = interaction.options.getString('mensaje_id');
  const panel = await getReactionRolePanel(interaction.guildId, messageId);
  if (!panel) {
    await interaction.reply({ content: '❌ No encontré ningún panel de reaction-roles con ese ID de mensaje en este servidor.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Best-effort: si el canal/mensaje ya no existe, se sigue igual con el borrado de la
  // fila — nunca deja el comando a mitad de camino por algo que el staff no controla.
  try {
    const channel = await interaction.guild.channels.fetch(panel.channelId).catch(() => null);
    const message = channel?.isTextBased() ? await channel.messages.fetch(panel.messageId).catch(() => null) : null;
    if (message) {
      const disabledEmbed = new EmbedBuilder()
        .setColor(NEUTRAL_COLOR)
        .setTitle(message.embeds[0]?.title || '🎭 Panel de roles')
        .setDescription('⚠️ Este panel fue eliminado por el staff — los botones ya no funcionan.')
        .setFooter({ text: BRAND_NAME });
      await message.edit({ embeds: [disabledEmbed], components: [] });
    }
  } catch (error) {
    console.error('⚠️ No se pudo editar el mensaje del panel al eliminarlo (se borra la config igual):', error);
  }

  await deleteReactionRolePanel(interaction.guildId, messageId);
  await interaction.reply({ content: '✅ Panel eliminado.', flags: MessageFlags.Ephemeral });
  await logConfigChange(interaction, `🎭 Panel de reaction-roles eliminado (mensaje ${messageId})`);
}

async function handleListar(interaction) {
  const panels = await listReactionRolePanels(interaction.guildId);
  if (panels.length === 0) {
    await interaction.reply({ content: 'ℹ️ Este servidor todavía no tiene paneles de reaction-roles. Creá uno con `/rolreacciones crear`.', flags: MessageFlags.Ephemeral });
    return;
  }

  const embed = new EmbedBuilder().setColor(BRAND_COLOR).setTitle('🎭 Paneles de reaction-roles').setFooter({ text: BRAND_NAME });

  for (const panel of panels) {
    const roleList = panel.roles.map((r) => `<@&${r.roleId}>`).join(', ') || '— sin roles';
    const jumpLink = `https://discord.com/channels/${interaction.guildId}/${panel.channelId}/${panel.messageId}`;
    embed.addFields({ name: `<#${panel.channelId}>`, value: `${roleList}\n[Ir al mensaje](${jumpLink}) • ID: \`${panel.messageId}\`` });
  }

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

export async function execute(interaction) {
  const isOwnerOrAdmin = interaction.guild.ownerId === interaction.user.id || interaction.member.permissions.has(PermissionFlagsBits.Administrator);
  if (!isOwnerOrAdmin) {
    await interaction.reply({ content: '❌ Solo el dueño del servidor o un administrador puede usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  const sub = interaction.options.getSubcommand();
  if (sub === 'crear') return handleCrear(interaction);
  if (sub === 'eliminar') return handleEliminar(interaction);
  if (sub === 'listar') return handleListar(interaction);
}
