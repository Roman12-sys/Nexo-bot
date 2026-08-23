// Lado "Discord" del sistema de salas de voz temporales (Join to Create) — mismo split
// que xpEngine.js/giveawayEngine.js: las *Store.js son data puro, esto es lo que mueve
// miembros, crea/borra canales y edita permisos.
//
// Modos: 'private' | 'invite_only' | 'public', más 'locked' independiente — separa
// expulsar (temporal) de bloquear (persistente hasta desbloquear), transferir
// propietario, estadísticas por sala, y /voice admin.
import { ChannelType, PermissionFlagsBits, OverwriteType, ActionRowBuilder, MessageFlags } from 'discord.js';
import * as voiceConfigStore from './voiceConfigStore.js';
import * as tempVoiceStore from './tempVoiceStore.js';
import {
  buildControlPanel,
  buildRenameModal,
  buildLimitModal,
  buildInviteSelect,
  buildKickSelect,
  buildBlockSelect,
  buildUnblockSelect,
  buildTransferSelect,
  buildAdminActionPanel,
  buildAdminTransferSelect,
} from './tempVoicePanel.js';
import { isStaff } from './permissions.js';
import { unlockAchievement, buildAchievementUnlockedEmbed } from './achievements.js';
import { registerButtonPrefix } from '../components/buttons.js';
import { registerSelectPrefix } from '../components/selects.js';
import { registerModalPrefix } from '../components/modals.js';

// Lock en memoria para que dos eventos de voz casi simultáneos del mismo usuario (ej.
// reconexión rápida del cliente de Discord) no disparen dos creaciones de sala en
// paralelo. RAM, no Supabase — es solo un candado de "ya se está procesando esto ahora
// mismo", no un dato de negocio.
const creatingUsers = new Set();

// Canal recién dejado vacío -> Timeout pendiente de borrado. Permite cancelar el borrado
// si alguien vuelve a entrar dentro de la ventana de gracia.
const EMPTY_CHECK_DELAY_MS = 10 * 1000;
const pendingEmptyChecks = new Map();

// Estadísticas en vivo de cada sala activa (channelId -> { uniqueUsers: Set<userId>,
// peakConcurrent: number }), sembradas al crear la sala y al reconciliar en el arranque.
// Se consumen (leen y borran) recién al eliminar la sala, momento en el que se escribe
// UNA fila resumen en voice_channel_stats — nunca una fila por evento. Se pierde si el
// bot se reinicia a mitad de la vida de una sala (mismo trade-off que guessSessions.js:
// no vale la pena persistir un contador en vivo por una estadística "nice to have").
const roomStats = new Map();

function cancelPendingEmptyCheck(channelId) {
  const handle = pendingEmptyChecks.get(channelId);
  if (handle) {
    clearTimeout(handle);
    pendingEmptyChecks.delete(channelId);
  }
}

function trackJoin(channelId, userId, channel) {
  const stats = roomStats.get(channelId);
  if (!stats) return;
  stats.uniqueUsers.add(userId);
  if (channel.members.size > stats.peakConcurrent) stats.peakConcurrent = channel.members.size;
}

// Lee (y borra) las estadísticas en memoria de una sala. Si no hay nada trackeado (caso
// raro: el bot se reinició y la sala se borró antes de que reconcileOnStartup terminara
// de sembrar el Map), usa la lista de miembros actual del canal como piso razonable.
function consumeRoomStats(channelId, channel) {
  const tracked = roomStats.get(channelId);
  roomStats.delete(channelId);
  if (tracked) return tracked;
  const fallbackIds = channel ? [...channel.members.keys()] : [];
  return { uniqueUsers: new Set(fallbackIds), peakConcurrent: fallbackIds.length };
}

// Punto único de borrado — lo usan la limpieza automática, el botón del dueño, /voice
// admin y el borrado manual externo. Centralizado para que ningún camino se olvide de
// registrar estadísticas o de limpiar el registro de Supabase.
async function finalizeRoomDeletion(channel, guildId, record, { alreadyDeleted = false, reason } = {}) {
  cancelPendingEmptyCheck(record.channelId);
  const stats = consumeRoomStats(record.channelId, channel);

  try {
    const createdMs = record.createdAt ? new Date(record.createdAt).getTime() : Date.now();
    await tempVoiceStore.recordChannelStats({
      guildId,
      channelId: record.channelId,
      ownerId: record.ownerId,
      type: record.type,
      createdAt: record.createdAt || new Date().toISOString(),
      durationSeconds: Math.max(0, Math.round((Date.now() - createdMs) / 1000)),
      uniqueUsersCount: stats.uniqueUsers.size,
      maxConcurrentUsers: stats.peakConcurrent,
    });
  } catch (error) {
    console.error('❌ [voz temporal] Error registrando estadísticas de la sala:', error);
  }

  if (!alreadyDeleted && channel) {
    await channel.delete(reason || 'Sala de voz temporal eliminada').catch(() => {});
  }
  await tempVoiceStore.deleteTempChannel(guildId, record.channelId).catch(() => {});
}

function scheduleEmptyCheck(channel, guildId) {
  cancelPendingEmptyCheck(channel.id); // no duplicar timers si ya había uno corriendo

  const handle = setTimeout(async () => {
    pendingEmptyChecks.delete(channel.id);
    try {
      const fresh = await channel.guild.channels.fetch(channel.id).catch(() => null);
      if (!fresh) {
        // Ya no existe (lo borraron a mano) — igual registramos estadísticas si había registro.
        const record = await tempVoiceStore.getTempChannelByChannelId(guildId, channel.id);
        if (record) await finalizeRoomDeletion(null, guildId, record, { alreadyDeleted: true });
        else roomStats.delete(channel.id);
        return;
      }
      if (fresh.members.size > 0) return; // alguien volvió a entrar durante la ventana de gracia

      const record = await tempVoiceStore.getTempChannelByChannelId(guildId, channel.id);
      if (!record) return; // no es (o dejó de ser) una sala temporal registrada

      await finalizeRoomDeletion(fresh, guildId, record, { reason: 'Sala de voz temporal vacía' });
    } catch (error) {
      console.error('❌ [voz temporal] Error al limpiar una sala vacía:', error);
    }
  }, EMPTY_CHECK_DELAY_MS).unref();

  pendingEmptyChecks.set(channel.id, handle);
}

// @everyone ve/puede-conectar según el modo. 'invite_only' se ve pero no se puede
// conectar sin overwrite individual; 'public_locked' (ver tempVoicePanel.js) no es un
// type guardado aparte, es type='public' + locked=true. El dueño y cualquier usuario
// invitado/bloqueado individualmente quedan con overwrites propios que esto no toca.
async function applyRoomPermissions(channel, guildId, { type, locked }) {
  const everyoneView = type !== 'private';
  const everyoneConnect = type === 'public' && !locked;
  await channel.permissionOverwrites.edit(guildId, { ViewChannel: everyoneView, Connect: everyoneConnect });
}

function buildInitialOverwrites(guild, ownerId) {
  return [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] },
    { id: ownerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] },
  ];
}

// --- Disparado desde events/voiceStateUpdate.js ---

export async function handleTempVoiceStateUpdate(oldState, newState) {
  if (oldState.channelId === newState.channelId) return; // solo nos interesan join/leave/move
  const guild = newState.guild || oldState.guild;

  if (newState.channelId) {
    cancelPendingEmptyCheck(newState.channelId); // volvió a entrar a una sala temporal -> cancela su borrado

    // Chequeo puramente en memoria (roomStats.has), no toca Supabase en el camino
    // caliente de "alguien se unió a un canal de voz cualquiera".
    if (roomStats.has(newState.channelId)) {
      const joinedChannel = newState.channel || (await guild.channels.fetch(newState.channelId).catch(() => null));
      if (joinedChannel) trackJoin(newState.channelId, newState.member.id, joinedChannel);
    }
  }

  // ¿Dejó vacía una sala temporal?
  if (oldState.channelId) {
    const leftChannel = oldState.channel || (await guild.channels.fetch(oldState.channelId).catch(() => null));
    if (leftChannel && leftChannel.members.size === 0) {
      const record = await tempVoiceStore.getTempChannelByChannelId(guild.id, oldState.channelId);
      if (record) scheduleEmptyCheck(leftChannel, guild.id);
    }
  }

  // ¿Entró al canal "Crear sala"?
  if (newState.channelId) {
    const guildConfig = await voiceConfigStore.getGuildVoiceConfig(guild.id);
    if (guildConfig?.enabled && guildConfig.createChannelId === newState.channelId) {
      await createTempChannelForMember(newState, guildConfig);
    }
  }
}

async function createTempChannelForMember(newState, guildConfig) {
  const member = newState.member;
  const guild = newState.guild;
  const lockKey = `${guild.id}:${member.id}`;
  if (creatingUsers.has(lockKey)) return;
  creatingUsers.add(lockKey);

  try {
    // Evita salas duplicadas: si ya tiene una activa, lo mandamos ahí en vez de crear otra.
    const existing = await tempVoiceStore.getTempChannelByOwner(guild.id, member.id);
    if (existing) {
      const existingChannel = await guild.channels.fetch(existing.channelId).catch(() => null);
      if (existingChannel) {
        if (member.voice.channelId === guildConfig.createChannelId) {
          await member.voice.setChannel(existingChannel).catch(() => {});
        }
        return;
      }
      // Registro obsoleto (la sala ya no existe de verdad) — se limpia y se sigue creando una nueva.
      await tempVoiceStore.deleteTempChannel(guild.id, existing.channelId);
    }

    const category = guildConfig.categoryId ? await guild.channels.fetch(guildConfig.categoryId).catch(() => null) : null;
    if (guildConfig.categoryId && !category) {
      console.error(`❌ [voz temporal] La categoría configurada (${guildConfig.categoryId}) ya no existe en ${guild.name}.`);
      return;
    }

    const me = guild.members.me;
    if (!me.permissions.has(PermissionFlagsBits.ManageChannels) || !me.permissions.has(PermissionFlagsBits.MoveMembers)) {
      console.error(`❌ [voz temporal] Al bot le faltan permisos (Gestionar canales / Mover miembros) en ${guild.name}.`);
      return;
    }

    let newChannel;
    try {
      newChannel = await guild.channels.create({
        name: `🔊・Sala de ${member.displayName}`.slice(0, 100),
        type: ChannelType.GuildVoice,
        parent: category?.id,
        permissionOverwrites: buildInitialOverwrites(guild, member.id),
      });
    } catch (error) {
      console.error('❌ [voz temporal] Error creando el canal:', error);
      return;
    }

    // El usuario pudo haberse ido del canal "Crear sala" mientras se creaba el canal.
    if (member.voice.channelId !== guildConfig.createChannelId) {
      await newChannel.delete('El usuario abandonó antes de completar la creación').catch(() => {});
      return;
    }

    try {
      await member.voice.setChannel(newChannel);
    } catch (error) {
      console.error('❌ [voz temporal] Error moviendo al usuario a su sala:', error);
      await newChannel.delete('No se pudo mover al usuario a la sala').catch(() => {});
      return;
    }

    try {
      await tempVoiceStore.createTempChannel({
        guildId: guild.id,
        channelId: newChannel.id,
        ownerId: member.id,
        categoryId: category?.id || null,
        type: 'private',
      });
    } catch (error) {
      console.error('❌ [voz temporal] Error registrando la sala en Supabase:', error);
      await newChannel.delete('No se pudo registrar la sala').catch(() => {});
      return;
    }

    roomStats.set(newChannel.id, { uniqueUsers: new Set([member.id]), peakConcurrent: 1 });

    const { embeds, components } = buildControlPanel({
      channel: newChannel,
      record: { ownerId: member.id, type: 'private', locked: false, createdAt: new Date() },
      memberCountOverride: 1,
    });
    await newChannel.send({ embeds, components }).catch(() => {});

    const achievement = await unlockAchievement(guild.id, member.id, 'anfitrion').catch(() => null);
    if (achievement) {
      await newChannel.send({ embeds: [buildAchievementUnlockedEmbed(member.user, achievement)] }).catch(() => {});
    }
  } finally {
    creatingUsers.delete(lockKey);
  }
}

// --- Disparado desde events/ready.js ---

export async function reconcileOnStartup(client) {
  for (const guild of client.guilds.cache.values()) {
    let records;
    try {
      records = await tempVoiceStore.getAllTempChannels(guild.id);
    } catch (error) {
      console.error(`❌ [voz temporal] Error consultando Supabase para ${guild.name}:`, error);
      continue;
    }
    if (records.length === 0) continue;

    let cleaned = 0;
    for (const record of records) {
      const channel = await guild.channels.fetch(record.channelId).catch(() => null);
      if (!channel) {
        await tempVoiceStore.deleteTempChannel(guild.id, record.channelId).catch(() => {});
        cleaned++;
        continue;
      }
      // Sembramos las estadísticas en vivo con lo que hay ahora mismo en el canal —
      // no sabemos qué pasó mientras el bot estaba caído, así que arrancamos de cero
      // desde el estado actual en vez de intentar reconstruir historia perdida.
      roomStats.set(channel.id, { uniqueUsers: new Set(channel.members.keys()), peakConcurrent: channel.members.size });
      if (channel.members.size === 0) scheduleEmptyCheck(channel, guild.id);
    }

    console.log(
      `✅ [voz temporal] ${guild.name}: ${records.length - cleaned} sala(s) activa(s)` +
        (cleaned ? `, ${cleaned} registro(s) obsoleto(s) limpiado(s).` : '.'),
    );
  }
}

// --- Disparado desde events/channelDelete.js ---

export async function handleChannelDeletedExternally(channel) {
  if (channel.type !== ChannelType.GuildVoice || !channel.guild) return;
  const record = await tempVoiceStore.getTempChannelByChannelId(channel.guild.id, channel.id).catch(() => null);
  if (record) await finalizeRoomDeletion(null, channel.guild.id, record, { alreadyDeleted: true });
}

// --- Panel de control: validación compartida ---

// Nunca confiamos en un ownerId embebido en el customId — siempre se resuelve desde
// Supabase, así nadie puede manipular la sala de otro con un customId armado a mano.
async function resolveOwnedRoom(interaction, channelId) {
  const record = await tempVoiceStore.getTempChannelByChannelId(interaction.guild.id, channelId);
  if (!record) return { error: '❌ Esta sala ya no existe o no es una sala temporal.' };

  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    await tempVoiceStore.deleteTempChannel(interaction.guild.id, channelId).catch(() => {});
    return { error: '❌ Esta sala ya no existe.' };
  }

  if (interaction.user.id !== record.ownerId && !(await isStaff(interaction))) {
    return { error: '❌ No puedes hacer esto porque no eres el propietario de esta sala.' };
  }

  return { record, channel };
}

// Transferir propiedad es la única acción que se reserva EXCLUSIVAMENTE al dueño real,
// ni siquiera el staff vía el panel normal — /voice admin tiene su propio camino de
// transferencia, separado y gateado por isStaff() a nivel comando.
async function resolveOwnedRoomStrict(interaction, channelId) {
  const record = await tempVoiceStore.getTempChannelByChannelId(interaction.guild.id, channelId);
  if (!record) return { error: '❌ Esta sala ya no existe o no es una sala temporal.' };

  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    await tempVoiceStore.deleteTempChannel(interaction.guild.id, channelId).catch(() => {});
    return { error: '❌ Esta sala ya no existe.' };
  }

  if (interaction.user.id !== record.ownerId) {
    return { error: '❌ Solo el propietario actual puede transferir la propiedad de esta sala.' };
  }

  return { record, channel };
}

async function refreshPanel(interaction, channel, record) {
  return interaction.update(buildControlPanel({ channel, record }));
}

// --- Acciones del panel (dueño, o staff salvo donde se indica lo contrario) ---

export async function handlePrivacySelect(interaction, channelId) {
  const { channel, error } = await resolveOwnedRoom(interaction, channelId);
  if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

  const mode = interaction.values[0]; // 'private' | 'invite_only' | 'public' | 'public_locked'
  const type = mode === 'public_locked' ? 'public' : mode;
  const locked = mode === 'public_locked';

  try {
    await applyRoomPermissions(channel, interaction.guild.id, { type, locked });
  } catch (error) {
    console.error('❌ [voz temporal] Error cambiando la privacidad:', error);
    return interaction.reply({ content: '❌ No se pudo cambiar la privacidad de la sala (¿me faltan permisos?).', flags: MessageFlags.Ephemeral });
  }

  const updated = await tempVoiceStore.updateTempChannel(interaction.guild.id, channelId, { type, locked });
  return refreshPanel(interaction, channel, updated);
}

export async function handleRenameButton(interaction, channelId) {
  const { channel, error } = await resolveOwnedRoom(interaction, channelId);
  if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
  return interaction.showModal(buildRenameModal(channelId, channel.name));
}

export async function handleRenameSubmit(interaction, channelId) {
  const { channel, error } = await resolveOwnedRoom(interaction, channelId);
  if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

  const nombre = interaction.fields.getTextInputValue('nombre').trim();
  if (!nombre) return interaction.reply({ content: '❌ El nombre no puede estar vacío.', flags: MessageFlags.Ephemeral });

  try {
    await channel.setName(nombre.slice(0, 100));
  } catch (error) {
    console.error('❌ [voz temporal] Error renombrando la sala:', error);
    return interaction.reply({ content: '❌ No se pudo cambiar el nombre (Discord limita los cambios de nombre a 2 cada 10 minutos).', flags: MessageFlags.Ephemeral });
  }

  const record = await tempVoiceStore.getTempChannelByChannelId(interaction.guild.id, channelId);
  return refreshPanel(interaction, channel, record);
}

export async function handleLimitButton(interaction, channelId) {
  const { channel, error } = await resolveOwnedRoom(interaction, channelId);
  if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
  return interaction.showModal(buildLimitModal(channelId, channel.userLimit));
}

export async function handleLimitSubmit(interaction, channelId) {
  const { channel, error } = await resolveOwnedRoom(interaction, channelId);
  if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

  const raw = interaction.fields.getTextInputValue('limite').trim();
  const limite = parseInt(raw, 10);
  if (Number.isNaN(limite) || limite < 0 || limite > 99) {
    return interaction.reply({ content: '❌ Ingresá un número entre 0 (sin límite) y 99.', flags: MessageFlags.Ephemeral });
  }

  try {
    await channel.setUserLimit(limite);
  } catch (error) {
    console.error('❌ [voz temporal] Error cambiando el límite:', error);
    return interaction.reply({ content: '❌ No se pudo cambiar el límite de usuarios.', flags: MessageFlags.Ephemeral });
  }

  const record = await tempVoiceStore.getTempChannelByChannelId(interaction.guild.id, channelId);
  return refreshPanel(interaction, channel, record);
}

export async function handleInviteButton(interaction, channelId) {
  const { error } = await resolveOwnedRoom(interaction, channelId);
  if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

  return interaction.reply({
    content: '➕ Elegí a quién invitar (podés elegir varios):',
    components: [new ActionRowBuilder().addComponents(buildInviteSelect(channelId))],
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleInviteSelect(interaction, channelId) {
  const { channel, error } = await resolveOwnedRoom(interaction, channelId);
  if (error) return interaction.update({ content: error, components: [] });

  const targetIds = interaction.values;
  try {
    for (const id of targetIds) {
      await channel.permissionOverwrites.edit(id, { ViewChannel: true, Connect: true });
    }
  } catch (error) {
    console.error('❌ [voz temporal] Error invitando usuarios:', error);
    return interaction.update({ content: '❌ No se pudo invitar a uno o más usuarios.', components: [] });
  }

  return interaction.update({ content: `✅ Usuario(s) invitado(s) correctamente: ${targetIds.map((id) => `<@${id}>`).join(', ')}.`, components: [] });
}

export async function handleKickButton(interaction, channelId) {
  const { error } = await resolveOwnedRoom(interaction, channelId);
  if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

  return interaction.reply({
    content: '🚫 Elegí a quién expulsar (solo lo saca de la sala ahora — si querés que no pueda volver a entrar, usá "Bloquear"):',
    components: [new ActionRowBuilder().addComponents(buildKickSelect(channelId))],
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleKickSelect(interaction, channelId) {
  const { record, channel, error } = await resolveOwnedRoom(interaction, channelId);
  if (error) return interaction.update({ content: error, components: [] });

  const targetId = interaction.values[0];
  if (targetId === record.ownerId) {
    return interaction.update({ content: '❌ No podés expulsarte a vos mismo de tu propia sala.', components: [] });
  }

  const targetMember = channel.members.get(targetId);
  if (!targetMember) {
    return interaction.update({ content: '❌ Ese usuario no está en la sala en este momento.', components: [] });
  }

  try {
    await targetMember.voice.disconnect('Expulsado de la sala temporal por su propietario');
  } catch (error) {
    console.error('❌ [voz temporal] Error expulsando usuario:', error);
    return interaction.update({ content: '❌ No se pudo expulsar a ese usuario.', components: [] });
  }
  return interaction.update({ content: `✅ <@${targetId}> fue expulsado de la sala.`, components: [] });
}

export async function handleBlockButton(interaction, channelId) {
  const { error } = await resolveOwnedRoom(interaction, channelId);
  if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

  return interaction.reply({
    content: '⛔ Elegí a quién bloquear (no va a poder volver a entrar hasta que lo desbloquees, ni aunque la sala sea pública):',
    components: [new ActionRowBuilder().addComponents(buildBlockSelect(channelId))],
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleBlockSelect(interaction, channelId) {
  const { record, channel, error } = await resolveOwnedRoom(interaction, channelId);
  if (error) return interaction.update({ content: error, components: [] });

  const targetId = interaction.values[0];
  if (targetId === record.ownerId) {
    return interaction.update({ content: '❌ No podés bloquearte a vos mismo.', components: [] });
  }

  try {
    await channel.permissionOverwrites.edit(targetId, { ViewChannel: false, Connect: false });
    const targetMember = channel.members.get(targetId);
    if (targetMember) await targetMember.voice.disconnect('Bloqueado de la sala temporal por su propietario');
  } catch (error) {
    console.error('❌ [voz temporal] Error bloqueando usuario:', error);
    return interaction.update({ content: '❌ No se pudo bloquear a ese usuario.', components: [] });
  }
  return interaction.update({ content: `✅ <@${targetId}> fue bloqueado y no puede volver a entrar hasta que lo desbloquees.`, components: [] });
}

export async function handleUnblockButton(interaction, channelId) {
  const { record, channel, error } = await resolveOwnedRoom(interaction, channelId);
  if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

  const blockedIds = [...channel.permissionOverwrites.cache.values()]
    .filter((ow) => ow.type === OverwriteType.Member && ow.id !== record.ownerId && ow.deny.has(PermissionFlagsBits.Connect))
    .map((ow) => ow.id);

  if (blockedIds.length === 0) {
    return interaction.reply({ content: 'ℹ️ No hay nadie bloqueado en esta sala.', flags: MessageFlags.Ephemeral });
  }

  const members = blockedIds.map((id) => channel.guild.members.cache.get(id)).filter(Boolean);
  if (members.length === 0) {
    return interaction.reply({ content: 'ℹ️ No hay nadie bloqueado en esta sala.', flags: MessageFlags.Ephemeral });
  }

  return interaction.reply({
    content: '✅ Elegí a quién desbloquear:',
    components: [new ActionRowBuilder().addComponents(buildUnblockSelect(channelId, members))],
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleUnblockSelect(interaction, channelId) {
  const { channel, error } = await resolveOwnedRoom(interaction, channelId);
  if (error) return interaction.update({ content: error, components: [] });

  const targetId = interaction.values[0];
  try {
    await channel.permissionOverwrites.delete(targetId);
  } catch (error) {
    console.error('❌ [voz temporal] Error desbloqueando usuario:', error);
    return interaction.update({ content: '❌ No se pudo desbloquear a ese usuario.', components: [] });
  }
  return interaction.update({ content: `✅ <@${targetId}> fue desbloqueado.`, components: [] });
}

export async function handleTransferButton(interaction, channelId) {
  const { error } = await resolveOwnedRoomStrict(interaction, channelId);
  if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

  return interaction.reply({
    content: '👑 Elegí al nuevo propietario:',
    components: [new ActionRowBuilder().addComponents(buildTransferSelect(channelId))],
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleTransferSelect(interaction, channelId) {
  const { record, channel, error } = await resolveOwnedRoomStrict(interaction, channelId);
  if (error) return interaction.update({ content: error, components: [] });

  const newOwnerId = interaction.values[0];
  if (newOwnerId === record.ownerId) {
    return interaction.update({ content: '❌ Ya sos el propietario de esta sala.', components: [] });
  }

  // Se valida ANTES de tocar ningún permiso de Discord: si el nuevo dueño ya
  // tiene su propia sala (UNIQUE(guild_id, owner_id)), transferTempChannelOwner
  // tiraría un error de constraint y el `channel.permissionOverwrites.edit` de
  // más abajo ya habría dejado a esa persona con acceso real a una sala que la
  // base de datos nunca terminó de asignarle. Chequear primero evita ese estado
  // inconsistente por completo, en vez de solo detectarlo después.
  const alreadyOwns = await tempVoiceStore.getTempChannelByOwner(interaction.guild.id, newOwnerId);
  if (alreadyOwns) {
    return interaction.update({ content: '❌ Esa persona ya tiene su propia sala — no puede tener dos a la vez.', components: [] });
  }

  try {
    await channel.permissionOverwrites.edit(newOwnerId, { ViewChannel: true, Connect: true, Speak: true });
  } catch (error) {
    console.error('❌ [voz temporal] Error dando permisos al nuevo propietario:', error);
    return interaction.update({ content: '❌ No se pudo completar la transferencia.', components: [] });
  }

  await tempVoiceStore.transferTempChannelOwner(interaction.guild.id, channelId, newOwnerId);
  return interaction.update({ content: `✅ <@${newOwnerId}> ahora es el propietario de esta sala.`, components: [] });
}

export async function handleDeleteButton(interaction, channelId) {
  const { record, channel, error } = await resolveOwnedRoom(interaction, channelId);
  if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

  await interaction.reply({ content: '🗑️ Sala eliminada.', flags: MessageFlags.Ephemeral });
  await finalizeRoomDeletion(channel, interaction.guild.id, record, { reason: 'Sala eliminada por su propietario' });
}

// --- /voice admin: mismas acciones que el panel, pero para cualquier sala registrada,
// gateadas por isStaff() (defensa en profundidad — solo el staff puede haber llegado
// hasta acá desde /voice admin, pero se re-chequea igual, mismo criterio que el resto
// del sistema). Nunca toca un canal que no esté en temporary_voice_channels.

async function resolveAdminRoom(interaction, channelId) {
  if (!(await isStaff(interaction))) return { error: '❌ No tienes permisos para utilizar esta herramienta.' };

  const record = await tempVoiceStore.getTempChannelByChannelId(interaction.guild.id, channelId);
  if (!record) return { error: '❌ Esta sala ya no existe o no es una sala temporal.' };

  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    await tempVoiceStore.deleteTempChannel(interaction.guild.id, channelId).catch(() => {});
    return { error: '❌ Esta sala ya no existe.' };
  }

  return { record, channel };
}

export async function handleAdminRoomSelect(interaction) {
  const channelId = interaction.values[0];
  const { record, channel, error } = await resolveAdminRoom(interaction, channelId);
  if (error) return interaction.update({ content: error, embeds: [], components: [] });
  return interaction.update(buildAdminActionPanel({ channel, record }));
}

export async function handleAdminLock(interaction, channelId) {
  const { record, channel, error } = await resolveAdminRoom(interaction, channelId);
  if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

  try {
    await applyRoomPermissions(channel, interaction.guild.id, { type: record.type, locked: true });
  } catch (error) {
    console.error('❌ [voz temporal] Error (admin) bloqueando sala:', error);
    return interaction.reply({ content: '❌ No se pudo bloquear la sala.', flags: MessageFlags.Ephemeral });
  }

  const updated = await tempVoiceStore.updateTempChannel(interaction.guild.id, channelId, { locked: true });
  return interaction.update(buildAdminActionPanel({ channel, record: updated }));
}

export async function handleAdminUnlock(interaction, channelId) {
  const { record, channel, error } = await resolveAdminRoom(interaction, channelId);
  if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

  try {
    await applyRoomPermissions(channel, interaction.guild.id, { type: record.type, locked: false });
  } catch (error) {
    console.error('❌ [voz temporal] Error (admin) desbloqueando sala:', error);
    return interaction.reply({ content: '❌ No se pudo desbloquear la sala.', flags: MessageFlags.Ephemeral });
  }

  const updated = await tempVoiceStore.updateTempChannel(interaction.guild.id, channelId, { locked: false });
  return interaction.update(buildAdminActionPanel({ channel, record: updated }));
}

export async function handleAdminTransferButton(interaction, channelId) {
  const { error } = await resolveAdminRoom(interaction, channelId);
  if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

  return interaction.reply({
    content: '👑 Elegí al nuevo propietario:',
    components: [new ActionRowBuilder().addComponents(buildAdminTransferSelect(channelId))],
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleAdminTransferSelect(interaction, channelId) {
  const { channel, error } = await resolveAdminRoom(interaction, channelId);
  if (error) return interaction.update({ content: error, components: [] });

  const newOwnerId = interaction.values[0];

  // Misma validación previa que el flujo del dueño (handleTransferSelect) — ver
  // el comentario ahí para el motivo completo.
  const alreadyOwns = await tempVoiceStore.getTempChannelByOwner(interaction.guild.id, newOwnerId);
  if (alreadyOwns) {
    return interaction.update({ content: '❌ Esa persona ya tiene su propia sala — no puede tener dos a la vez.', components: [] });
  }

  try {
    await channel.permissionOverwrites.edit(newOwnerId, { ViewChannel: true, Connect: true, Speak: true });
  } catch (error) {
    console.error('❌ [voz temporal] Error (admin) transfiriendo propiedad:', error);
    return interaction.update({ content: '❌ No se pudo completar la transferencia.', components: [] });
  }

  await tempVoiceStore.transferTempChannelOwner(interaction.guild.id, channelId, newOwnerId);
  return interaction.update({ content: `✅ <@${newOwnerId}> ahora es el propietario de esta sala.`, components: [] });
}

export async function handleAdminDelete(interaction, channelId) {
  const { record, channel, error } = await resolveAdminRoom(interaction, channelId);
  if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

  await interaction.reply({ content: '🗑️ Sala eliminada.', flags: MessageFlags.Ephemeral });
  await finalizeRoomDeletion(channel, interaction.guild.id, record, { reason: 'Sala eliminada por staff (/voice admin)' });
}

// --- Registro en los routers de componentes ---
// El channelId va embebido en el customId solo para saber A QUÉ sala se refiere el
// click; el ownerId NUNCA se confía desde acá — resolveOwnedRoom(Strict) siempre lo
// revalida contra el registro real en Supabase antes de hacer nada.

registerButtonPrefix('voice_rename_', (i) => handleRenameButton(i, i.customId.slice('voice_rename_'.length)));
registerButtonPrefix('voice_limit_', (i) => handleLimitButton(i, i.customId.slice('voice_limit_'.length)));
registerButtonPrefix('voice_invite_', (i) => handleInviteButton(i, i.customId.slice('voice_invite_'.length)));
registerButtonPrefix('voice_kick_', (i) => handleKickButton(i, i.customId.slice('voice_kick_'.length)));
registerButtonPrefix('voice_block_', (i) => handleBlockButton(i, i.customId.slice('voice_block_'.length)));
registerButtonPrefix('voice_unblock_', (i) => handleUnblockButton(i, i.customId.slice('voice_unblock_'.length)));
registerButtonPrefix('voice_transfer_', (i) => handleTransferButton(i, i.customId.slice('voice_transfer_'.length)));
registerButtonPrefix('voice_delete_', (i) => handleDeleteButton(i, i.customId.slice('voice_delete_'.length)));

registerButtonPrefix('voice_admin_transfer_', (i) => handleAdminTransferButton(i, i.customId.slice('voice_admin_transfer_'.length)));
registerButtonPrefix('voice_admin_lock_', (i) => handleAdminLock(i, i.customId.slice('voice_admin_lock_'.length)));
registerButtonPrefix('voice_admin_unlock_', (i) => handleAdminUnlock(i, i.customId.slice('voice_admin_unlock_'.length)));
registerButtonPrefix('voice_admin_delete_', (i) => handleAdminDelete(i, i.customId.slice('voice_admin_delete_'.length)));

registerSelectPrefix('voice_privacy_', (i) => handlePrivacySelect(i, i.customId.slice('voice_privacy_'.length)));
registerSelectPrefix('voice_invite_select_', (i) => handleInviteSelect(i, i.customId.slice('voice_invite_select_'.length)));
registerSelectPrefix('voice_kick_select_', (i) => handleKickSelect(i, i.customId.slice('voice_kick_select_'.length)));
registerSelectPrefix('voice_block_select_', (i) => handleBlockSelect(i, i.customId.slice('voice_block_select_'.length)));
registerSelectPrefix('voice_unblock_select_', (i) => handleUnblockSelect(i, i.customId.slice('voice_unblock_select_'.length)));
registerSelectPrefix('voice_transfer_select_', (i) => handleTransferSelect(i, i.customId.slice('voice_transfer_select_'.length)));
registerSelectPrefix('voice_admin_select', (i) => handleAdminRoomSelect(i));
registerSelectPrefix('voice_admin_transfer_select_', (i) => handleAdminTransferSelect(i, i.customId.slice('voice_admin_transfer_select_'.length)));

registerModalPrefix('modal_voice_rename_', (i) => handleRenameSubmit(i, i.customId.slice('modal_voice_rename_'.length)));
registerModalPrefix('modal_voice_limit_', (i) => handleLimitSubmit(i, i.customId.slice('modal_voice_limit_'.length)));
