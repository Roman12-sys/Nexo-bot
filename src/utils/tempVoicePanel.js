// Embeds y componentes del panel de control de una sala de voz temporal. Puro (sin
// llamadas a Discord ni a Supabase) — separado porque no hay un "comando" natural que
// sea dueño de esto (el panel lo dispara un voiceStateUpdate, no un slash command).
//
// El select de 4 modos: "Pública bloqueada" no es un tipo guardado aparte, es
// type='public' + locked=true (ver applyRoomPermissions en tempVoiceEngine.js).
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
} from 'discord.js';
import { BRAND_COLOR, BRAND_NAME } from './embeds.js';

export const PRIVACY_MODES = [
  { value: 'private', label: '🔒 Privada', description: 'Invisible salvo para quien permitas entrar' },
  { value: 'invite_only', label: '👥 Solo invitados', description: 'Se ve, pero solo entra quien invites' },
  { value: 'public', label: '🌐 Pública', description: 'Cualquiera del servidor puede entrar' },
  { value: 'public_locked', label: '🔐 Pública bloqueada', description: 'Se ve, pero nadie nuevo puede entrar por ahora' },
];

// El "modo" que ve el usuario es una combinación de type+locked — ver el comentario del
// módulo. Esto convierte el registro de la sala en el value del select de arriba.
export function modeFromRecord(record) {
  if (record.type === 'public' && record.locked) return 'public_locked';
  return record.type;
}

export function describeMode(record) {
  const mode = PRIVACY_MODES.find((m) => m.value === modeFromRecord(record));
  return mode ? mode.label : record.type;
}

// memberCountOverride: justo después de crear la sala, channel.members todavía puede no
// reflejar al dueño (el evento de voz que actualiza la caché llega un instante después
// de que setChannel() resuelve) — para ese primer envío pasamos el conteo real conocido
// (1) en vez de leerlo del canal.
export function buildControlPanel({ channel, record, memberCountOverride }) {
  const memberCount = memberCountOverride ?? channel.members.size;
  const limitText = channel.userLimit ? `/${channel.userLimit}` : '';

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🎙️ Panel de control de sala')
    .addFields(
      { name: 'Propietario', value: `<@${record.ownerId}>`, inline: true },
      { name: 'Tipo', value: describeMode(record), inline: true },
      { name: 'Usuarios', value: `${memberCount}${limitText}`, inline: true },
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp(record.createdAt ? new Date(record.createdAt) : new Date());

  const rowPrivacy = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`voice_privacy_${channel.id}`)
      .setPlaceholder('🔐 Cambiar privacidad')
      .addOptions(
        PRIVACY_MODES.map((m) => ({
          label: m.label,
          value: m.value,
          description: m.description,
          default: modeFromRecord(record) === m.value,
        })),
      ),
  );

  const rowControl = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`voice_rename_${channel.id}`).setLabel('✏️ Nombre').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`voice_limit_${channel.id}`).setLabel('👥 Límite').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`voice_transfer_${channel.id}`).setLabel('👑 Transferir').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`voice_delete_${channel.id}`).setLabel('🗑️ Eliminar sala').setStyle(ButtonStyle.Danger),
  );

  const rowUsers = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`voice_invite_${channel.id}`).setLabel('➕ Invitar').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`voice_kick_${channel.id}`).setLabel('🚫 Expulsar').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`voice_block_${channel.id}`).setLabel('⛔ Bloquear').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`voice_unblock_${channel.id}`).setLabel('✅ Desbloquear').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [rowPrivacy, rowControl, rowUsers] };
}

export function buildRenameModal(channelId, currentName) {
  const modal = new ModalBuilder().setCustomId(`modal_voice_rename_${channelId}`).setTitle('Cambiar nombre de la sala');
  const input = new TextInputBuilder()
    .setCustomId('nombre')
    .setLabel('Nuevo nombre')
    .setStyle(TextInputStyle.Short)
    .setValue((currentName || '').slice(0, 100))
    .setMaxLength(100)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

export function buildLimitModal(channelId, currentLimit) {
  const modal = new ModalBuilder().setCustomId(`modal_voice_limit_${channelId}`).setTitle('Cambiar límite de usuarios');
  const input = new TextInputBuilder()
    .setCustomId('limite')
    .setLabel('Límite (0 = sin límite, máx 99)')
    .setStyle(TextInputStyle.Short)
    .setValue(String(currentLimit || 0))
    .setMaxLength(2)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

// Tope propio (no un límite de Discord): invitar es para juntar gente puntual, no para
// mandar una mención masiva desde acá — 10 alcanza de sobra para una sala de voz.
const MAX_INVITE_SELECTION = 10;

export function buildInviteSelect(channelId) {
  return new UserSelectMenuBuilder()
    .setCustomId(`voice_invite_select_${channelId}`)
    .setPlaceholder('Elegí a quién invitar (podés elegir varios)')
    .setMinValues(1)
    .setMaxValues(MAX_INVITE_SELECTION);
}

export function buildKickSelect(channelId) {
  return new UserSelectMenuBuilder().setCustomId(`voice_kick_select_${channelId}`).setPlaceholder('Elegí a quién expulsar de la sala').setMinValues(1).setMaxValues(1);
}

export function buildBlockSelect(channelId) {
  return new UserSelectMenuBuilder().setCustomId(`voice_block_select_${channelId}`).setPlaceholder('Elegí a quién bloquear').setMinValues(1).setMaxValues(1);
}

// A diferencia de invitar/expulsar/bloquear (UserSelectMenu, cualquier miembro del
// server), desbloquear necesita listar SOLO a quienes ya están bloqueados — Discord no
// permite acotar un UserSelectMenu a una lista específica, así que esto arma un
// StringSelectMenu a partir de los overwrites reales del canal.
export function buildUnblockSelect(channelId, blockedMembers) {
  return new StringSelectMenuBuilder()
    .setCustomId(`voice_unblock_select_${channelId}`)
    .setPlaceholder('Elegí a quién desbloquear')
    .addOptions(blockedMembers.slice(0, 25).map((m) => ({ label: m.user.tag.slice(0, 100), value: m.id })));
}

export function buildTransferSelect(channelId) {
  return new UserSelectMenuBuilder().setCustomId(`voice_transfer_select_${channelId}`).setPlaceholder('Elegí al nuevo propietario').setMinValues(1).setMaxValues(1);
}

// --- /voice admin: lista de salas + mini panel de acciones staff ---
// No reusa buildControlPanel — el admin no necesita el panel completo del dueño,
// solo las 4 acciones que corresponden a staff (ver tempVoiceEngine.js's handleAdmin*).

export function buildAdminRoomSelect(records, guild) {
  const options = records.slice(0, 25).map((r) => {
    const channel = guild.channels.cache.get(r.channelId);
    const owner = guild.members.cache.get(r.ownerId);
    return {
      label: (channel?.name || `Sala ${r.channelId}`).slice(0, 100),
      description: `Dueño: ${owner?.user.tag || r.ownerId}`.slice(0, 100),
      value: r.channelId,
    };
  });
  return new StringSelectMenuBuilder().setCustomId('voice_admin_select').setPlaceholder('Elegí una sala activa').addOptions(options);
}

export function buildAdminActionPanel({ channel, record }) {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🛠️ Administrar sala (staff)')
    .addFields(
      { name: 'Sala', value: `${channel}`, inline: true },
      { name: 'Propietario', value: `<@${record.ownerId}>`, inline: true },
      { name: 'Tipo', value: describeMode(record), inline: true },
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`voice_admin_transfer_${channel.id}`).setLabel('👑 Transferir propietario').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`voice_admin_lock_${channel.id}`).setLabel('🔒 Bloquear sala').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`voice_admin_unlock_${channel.id}`).setLabel('🔓 Desbloquear sala').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`voice_admin_delete_${channel.id}`).setLabel('🗑️ Eliminar sala').setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [row] };
}

export function buildAdminTransferSelect(channelId) {
  return new UserSelectMenuBuilder().setCustomId(`voice_admin_transfer_select_${channelId}`).setPlaceholder('Elegí al nuevo propietario').setMinValues(1).setMaxValues(1);
}
