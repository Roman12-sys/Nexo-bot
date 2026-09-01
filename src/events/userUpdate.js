import { Events } from 'discord.js';
import { createAvatarChangeLogEmbed, createUsernameChangeLogEmbed } from '../utils/logEmbeds.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';

export const name = Events.UserUpdate;
export const once = false;

// QUÉ CAMBIÓ: throttle por usuario — antes CADA UserUpdate (Discord dispara uno por
// cada campo que cambia, y algunos clientes/apps de terceros permiten cambiar avatar
// varias veces seguidas en segundos, ej. probando fotos) hacía un fan-out completo a
// TODOS los servidores mutuos con el bot, sin ningún límite. Con un usuario en muchos
// servidores y varios cambios seguidos, eso multiplicaba llamadas y mensajes de log
// innecesarios rápido. Ventana corta (2 min) a propósito: solo colapsa ráfagas cortas
// del MISMO usuario, nunca bloquea un cambio real y espaciado — mismo criterio de
// "no bloquear indefinidamente" que el resto del proyecto.
// MOTIVO: auditoría Fase 2B, sección 8.
const THROTTLE_MS = 2 * 60 * 1000;
const lastLoggedAt = new Map(); // userId -> timestamp del último cambio logueado

// Barrido periódico, mismo criterio que rateLimiter.js/missionsStore.js — sin esto el
// Map crece para siempre con un usuario cuyo perfil cambió una sola vez hace semanas.
setInterval(() => {
  const now = Date.now();
  for (const [userId, ts] of lastLoggedAt) {
    if (now - ts >= THROTTLE_MS) lastLoggedAt.delete(userId);
  }
}, 10 * 60 * 1000).unref();

export async function execute(oldUser, newUser, client) {
  try {
    // userUpdate dispara para cualquier usuario cacheado por el bot, sin
    // atarse a un servidor puntual (a diferencia de gNoX, que era single-tenant
    // y filtraba por config.guildId). En NEXOBOT recorremos todos los servidores
    // donde el bot está y en los que el usuario está cacheado como miembro,
    // logueando el cambio en el canal de actividad configurado de cada uno.
    // Se arman los embeds UNA sola vez (no dependen del guild, el cambio es el mismo
    // para todos) y se mandan juntos en un solo send por guild — antes eran hasta 3
    // sends separados por guild, y alguien en varios servidores mutuos con el bot podía
    // multiplicar eso bastante para un solo cambio de perfil.
    const embeds = [];
    if (oldUser.avatar !== newUser.avatar) embeds.push(createAvatarChangeLogEmbed({ oldUser, newUser }));
    if (oldUser.username !== newUser.username) embeds.push(createUsernameChangeLogEmbed({ oldUser, newUser, field: 'username' }));
    if (oldUser.globalName !== newUser.globalName) embeds.push(createUsernameChangeLogEmbed({ oldUser, newUser, field: 'globalName' }));
    if (embeds.length === 0) return;

    // El throttle se chequea/marca acá, no antes — un UserUpdate que no toca ninguno de
    // los 3 campos que nos importan (arriba) no debe consumir ni extender la ventana.
    const lastLogged = lastLoggedAt.get(newUser.id) || 0;
    if (Date.now() - lastLogged < THROTTLE_MS) return;
    lastLoggedAt.set(newUser.id, Date.now());

    const guildsWithMember = client.guilds.cache.filter((guild) => guild.members.cache.has(newUser.id));
    if (guildsWithMember.size === 0) return;

    for (const guild of guildsWithMember.values()) {
      const logChannel = await getGuildLogChannel(client, guild.id, 'activity');
      if (!logChannel) continue;
      await logChannel.send({ embeds });
    }
  } catch (error) {
    console.error('❌ Error registrando cambio de usuario:', error);
  }
}
