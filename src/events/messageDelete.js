import { Events, AuditLogEvent, AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { createMessageDeleteLogEmbed } from '../utils/logEmbeds.js';
import { findExecutor } from '../utils/auditLog.js';
import { getGuildLogChannel } from '../utils/guildLogChannels.js';

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // límite estándar de subida de bot
const MAX_EMBEDS_PER_MESSAGE = 10;

// El link del CDN de un adjunto de un mensaje borrado puede dejar de servir en
// minutos. La única forma real de no perder el contenido audiovisual es
// descargarlo y re-subirlo ya mismo, como archivo nuevo en el propio log.
async function reuploadAttachments(message) {
  if (message.partial || !message.attachments?.size) return { files: [], results: [] };

  const attachments = [...message.attachments.values()];
  const settled = await Promise.allSettled(
    attachments.map(async (a) => {
      if (a.size > MAX_ATTACHMENT_BYTES) throw new Error('supera 8MB, no se pudo re-subir');
      // Sin timeout, un CDN lento/caído cuelga esta descarga indefinidamente — y como
      // se espera con Promise.all más abajo, el mensaje entero de log queda sin
      // mandarse hasta que Discord mate la conexión por su cuenta (si es que lo hace).
      const res = await fetch(a.url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`no se pudo descargar (HTTP ${res.status})`);
      const buffer = Buffer.from(await res.arrayBuffer());
      return new AttachmentBuilder(buffer, { name: a.name || 'archivo' });
    }),
  );

  const files = [];
  const results = [];
  settled.forEach((outcome, i) => {
    const a = attachments[i];
    if (outcome.status === 'fulfilled') {
      files.push(outcome.value);
      results.push({ name: a.name, reuploaded: true });
    } else {
      results.push({ name: a.name, url: a.url, reuploaded: false, reason: outcome.reason?.message || 'error desconocido' });
    }
  });

  return { files, results };
}

// Reenvía los embeds que traía el mensaje original (link previews, embeds de
// otros bots, etc.) para que tampoco se pierdan al borrarse.
function forwardedEmbeds(message) {
  if (message.partial || !message.embeds?.length) return [];
  return message.embeds.slice(0, MAX_EMBEDS_PER_MESSAGE - 1).map((e) => EmbedBuilder.from(e));
}

export const name = Events.MessageDelete;
export const once = false;

export async function execute(message, client) {
  try {
    // Ignorar mensajes fuera de un servidor (DMs)
    if (!message.guild) return;

    const logChannel = await getGuildLogChannel(client, message.guild.id, 'activity');
    if (!logChannel) {
      console.warn('⚠️ No se pudo encontrar o acceder al canal de logs configurado para este servidor.');
      return;
    }

    // Intentar determinar quién eliminó el mensaje mediante el audit log,
    // únicamente si es técnicamente fiable. Si no, se indica claramente en el log.
    let executor = null;
    if (message.author?.id) {
      const entry = await findExecutor(message.guild, {
        type: AuditLogEvent.MessageDelete,
        targetId: message.author.id,
      });
      if (entry) executor = entry.executor;
    }

    // El propio bot borra mensajes en varios lugares (detector de secretos, anti-spam,
    // filtro de castigo, /clear con 1 solo mensaje) — cada uno ya loguea su propio
    // contexto en el canal de moderación. Sin este guard, acá se duplicaba con un
    // "🗑️ Mensaje eliminado" genérico atribuido a "Nexo Bot" en el canal de actividad.
    if (executor?.id === client.user.id) return;

    const [{ files, results }, extraEmbeds] = await Promise.all([
      reuploadAttachments(message),
      Promise.resolve(forwardedEmbeds(message)),
    ]);

    const embed = createMessageDeleteLogEmbed({ message, executor, attachmentResults: results });
    await logChannel.send({ embeds: [embed, ...extraEmbeds], files });
  } catch (error) {
    console.error('❌ Error registrando el mensaje eliminado:', error);
  }
}
