// Validaciones compartidas por todos los comandos de música — mismo estilo que
// getModerationBlockReason (permissions.js): devuelve un string de error listo para
// responder, o null/objeto de éxito. Nunca se confía en nada del cliente para saber
// "con qué canal de voz está el bot" — siempre se lee de musicSessionStore, la única
// fuente de verdad de la sesión activa.
import { PermissionFlagsBits } from 'discord.js';
import { getSession } from './musicSessionStore.js';

export function getUserVoiceChannel(interaction) {
  return interaction.member?.voice?.channel || null;
}

export function requireUserInVoiceChannel(interaction) {
  const channel = getUserVoiceChannel(interaction);
  if (!channel) return '❌ Tenés que estar en un canal de voz para usar esto.';
  return null;
}

export function requireBotVoicePermissions(voiceChannel) {
  const me = voiceChannel.guild.members.me;
  if (!me) return '❌ No se pudieron verificar los permisos del bot en ese canal.';

  const perms = voiceChannel.permissionsFor(me);
  if (!perms?.has(PermissionFlagsBits.Connect)) {
    return '❌ Al bot le falta el permiso "Conectar" en ese canal de voz.';
  }
  if (!perms?.has(PermissionFlagsBits.Speak)) {
    return '❌ Al bot le falta el permiso "Hablar" en ese canal de voz.';
  }
  return null;
}

// Para comandos de solo lectura (/queue, /nowplaying) — no hace falta estar en el mismo
// canal que el bot para VER qué está sonando, solo que haya algo sonando. Devuelve
// { error } o { session }.
export function requireActiveSession(interaction) {
  const session = getSession(interaction.guildId);
  if (!session) return { error: 'ℹ️ No hay ninguna reproducción activa en este servidor.' };
  return { session };
}

// Para comandos que CONTROLAN una reproducción ya activa (pause/resume/skip/stop/
// volume/shuffle/remove/loop/disconnect): exige que exista sesión Y que quien ejecuta
// el comando esté en el MISMO canal que el bot — así nadie controla la música de otro
// canal de voz del mismo servidor. Devuelve { error } o { session }.
export function requireActiveSessionInUserChannel(interaction) {
  const session = getSession(interaction.guildId);
  if (!session) return { error: 'ℹ️ No hay ninguna reproducción activa en este servidor.' };

  const userChannel = getUserVoiceChannel(interaction);
  if (!userChannel || userChannel.id !== session.voiceChannelId) {
    return { error: '❌ Tenés que estar en el mismo canal de voz que el bot para controlar la reproducción.' };
  }

  return { session };
}
