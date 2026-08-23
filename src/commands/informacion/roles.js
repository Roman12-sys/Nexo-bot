import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';

const COUNTRY_NAMES = new Set([
  'argentina', 'bolivia', 'brasil', 'chile', 'colombia', 'ecuador',
  'paraguay', 'perú', 'peru', 'uruguay', 'venezuela', 'méxico', 'mexico',
  'panamá', 'panama', 'puerto rico', 'españa', 'espana',
]);

const STAFF_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.ManageRoles,
];

// Clasifica cada rol en una categoría visual. El orden de las reglas importa:
// la primera que matchea gana (ej: "Server Booster" es managed=true pero no es un bot).
function categorize(role) {
  const name = role.name.trim();
  const lower = name.toLowerCase();

  if (/^-+$|^-+[a-záéíóúñ]+-+$/i.test(name.replace(/\s/g, ''))) return null; // separador visual, no es un rol funcional
  if (name === 'Server Booster') return '💎 Nitro Boost';
  if (COUNTRY_NAMES.has(lower)) return '🌎 Países';
  if (role.managed) return '🤖 Bots / Integraciones';
  if (/bot/i.test(name)) return '🤖 Bots / Integraciones';
  if (STAFF_PERMISSIONS.some((perm) => role.permissions.has(perm))) return '🛡️ Staff / Moderación';
  return '👥 Comunidad';
}

const CATEGORY_ORDER = [
  '🛡️ Staff / Moderación',
  '🤖 Bots / Integraciones',
  '👥 Comunidad',
  '💎 Nitro Boost',
  '🌎 Países',
];

export function buildRolesEmbed(guild) {
  const roles = [...guild.roles.cache.values()]
    .filter((r) => r.id !== guild.id) // excluye @everyone
    .sort((a, b) => b.position - a.position);

  const buckets = new Map();
  let skippedSeparators = 0;

  for (const role of roles) {
    const category = categorize(role);
    if (!category) {
      skippedSeparators += 1;
      continue;
    }
    if (!buckets.has(category)) buckets.set(category, []);
    buckets.get(category).push(role);
  }

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`🎭 Roles de ${guild.name}`)
    .setDescription(`${roles.length} roles · ${guild.memberCount.toLocaleString('es-ES')} miembros`)
    .setTimestamp()
    .setFooter({ text: skippedSeparators > 0 ? `${BRAND_NAME} • ${skippedSeparators} rol(es) separador(es) omitidos` : BRAND_NAME });

  for (const category of CATEGORY_ORDER) {
    const list = buckets.get(category);
    if (!list || list.length === 0) continue;

    const value = list
      .map((r) => `${r} — **${r.members.size}** miembro${r.members.size === 1 ? '' : 's'}`)
      .join('\n')
      .slice(0, 1024);

    embed.addFields({ name: `${category} (${list.length})`, value, inline: false });
  }

  return embed;
}

export const data = new SlashCommandBuilder()
  .setName('roles')
  .setDescription('Lista todos los roles del servidor, agrupados por categoría, con su cantidad de miembros.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!(await isStaff(interaction))) {
    await interaction.reply({ content: '❌ No tenés permisos para usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply();
  try {
    await interaction.guild.members.fetch();
    const embed = buildRolesEmbed(interaction.guild);
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('❌ Error al ejecutar /roles:', error);
    await interaction.editReply({ content: '❌ Ocurrió un error al obtener los roles del servidor.' });
  }
}
