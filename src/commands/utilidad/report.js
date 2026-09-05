// Fase 4C-1 — la auditoría de producto encontró que un miembro que quiere avisarle algo
// al staff (un usuario, un mensaje, una situación) no tenía ningún camino DENTRO del
// bot: tenía que buscar manualmente a un moderador. Reutiliza patrones ya existentes en
// vez de armar un sistema paralelo: getGuildLogChannel (mismo helper que /warn, /ban,
// etc. usan para resolver+validar un canal de logs), el cooldown en Map autolimpiante de
// /encuesta, y el embed simple estilo logEmbeds.js.
import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { BRAND_NAME, LOG_COLOR } from '../../utils/embeds.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';

// Anti-spam simple, mismo criterio que POLL_COOLDOWN_MS de encuesta.js: por guild+usuario
// (no global), en memoria (nunca amerita Supabase). 60s en vez de los 2 min de /encuesta
// — un reporte es una acción privada/ephemeral (no genera contenido público que pueda
// llenar un canal), así que el riesgo real de spam es menor, pero igual necesita algún
// piso para que no se pueda golpear el canal de reportes en loop.
const REPORT_COOLDOWN_MS = 60 * 1000;
const lastReportAt = new Map(); // `${guildId}:${userId}` -> timestamp del último reporte

setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of lastReportAt) {
    if (now - ts >= REPORT_COOLDOWN_MS) lastReportAt.delete(key);
  }
}, 10 * 60 * 1000).unref();

// Acepta un link de mensaje completo (canal puede ser distinto al actual, SIEMPRE que
// sea del mismo servidor — un link de otro guild se rechaza, no tiene sentido ni es
// seguro resolverlo acá) o un ID crudo (se asume del canal actual, que es lo único que
// un ID solo puede significar sin más contexto).
const MESSAGE_LINK_RE = /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)$/;
const SNOWFLAKE_RE = /^\d{17,20}$/;

function parseMessageRef(interaction, raw) {
  const trimmed = raw.trim();

  const linkMatch = trimmed.match(MESSAGE_LINK_RE);
  if (linkMatch) {
    const [, guildId, channelId, messageId] = linkMatch;
    if (guildId !== interaction.guildId) {
      return { error: '❌ Ese link de mensaje no pertenece a este servidor.' };
    }
    return { channelId, messageId };
  }

  if (SNOWFLAKE_RE.test(trimmed)) {
    return { channelId: interaction.channelId, messageId: trimmed };
  }

  return { error: '❌ El campo "mensaje" tiene que ser un link de mensaje de Discord o el ID de un mensaje de este canal.' };
}

// Best-effort: el mensaje puede haber sido borrado, o estar en un canal al que el bot no
// tiene acceso — en cualquiera de los dos casos el reporte sigue adelante igual, solo sin
// poder mostrarle el contenido al staff (queda el link igual, por si el canal reaparece).
async function resolveMessage(interaction, channelId, messageId) {
  try {
    const channel = channelId === interaction.channelId ? interaction.channel : await interaction.guild.channels.fetch(channelId);
    if (!channel?.isTextBased?.()) return null;
    return await channel.messages.fetch(messageId);
  } catch {
    return null;
  }
}

export const data = new SlashCommandBuilder()
  .setName('report')
  .setDescription('Reportá un usuario, un mensaje o una situación al staff de este servidor.')
  .addStringOption((o) => o.setName('motivo').setDescription('Describí qué pasó').setRequired(true).setMaxLength(1000))
  .addUserOption((o) => o.setName('usuario').setDescription('Usuario reportado (opcional)').setRequired(false))
  .addStringOption((o) => o.setName('mensaje').setDescription('Link o ID del mensaje reportado (opcional)').setRequired(false))
  .setDMPermission(false);

export async function execute(interaction) {
  // Quién reporta es SIEMPRE interaction.user — Discord ya autenticó la interacción, no
  // hay ningún campo de "reportado por" que un usuario pueda completar a mano ni forma
  // de falsificarlo.
  const cooldownKey = `${interaction.guildId}:${interaction.user.id}`;
  const lastReport = lastReportAt.get(cooldownKey) || 0;
  const elapsed = Date.now() - lastReport;
  if (elapsed < REPORT_COOLDOWN_MS) {
    const retryAt = Math.floor((lastReport + REPORT_COOLDOWN_MS) / 1000);
    await interaction.reply({ content: `⏳ Ya mandaste un reporte hace poco. Podés mandar otro <t:${retryAt}:R>.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const motivo = interaction.options.getString('motivo');
  const targetUser = interaction.options.getUser('usuario');
  const mensajeRaw = interaction.options.getString('mensaje');

  let messageRef = null;
  if (mensajeRaw) {
    const parsed = parseMessageRef(interaction, mensajeRaw);
    if (parsed.error) {
      await interaction.reply({ content: parsed.error, flags: MessageFlags.Ephemeral });
      return;
    }
    messageRef = parsed;
  }

  // Recién acá se consume el cooldown — un intento rechazado por un link de mensaje mal
  // formado (arriba) no debería gastarle el turno a quien reporta. Mismo criterio que
  // encuesta.js con sus opciones inválidas.
  lastReportAt.set(cooldownKey, Date.now());

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const resolvedMessage = messageRef ? await resolveMessage(interaction, messageRef.channelId, messageRef.messageId) : null;

  // 'report' (report_channel_id) si el servidor lo configuró; si no, reusa el canal de
  // logs de moderación que YA existe en la mayoría de los servidores desde /setup — así
  // /report funciona de entrada en un server recién configurado, sin exigir un segundo
  // canal antes de que el staff pueda recibir nada.
  const reportChannel =
    (await getGuildLogChannel(interaction.client, interaction.guildId, 'report')) ||
    (await getGuildLogChannel(interaction.client, interaction.guildId, 'moderation'));

  if (!reportChannel) {
    await interaction.editReply({
      content:
        '❌ Este servidor todavía no tiene un canal para recibir reportes. Avisale a un administrador: puede correr `/config canal-reportes` o activar el módulo de moderación con `/setup`.',
    });
    return;
  }

  const fields = [
    { name: 'Reportado por', value: `${interaction.user.tag} (\`${interaction.user.id}\`)`, inline: true },
    { name: 'Canal', value: `<#${interaction.channelId}>`, inline: true },
  ];

  if (targetUser) {
    fields.push({ name: 'Usuario reportado', value: `${targetUser.tag} (\`${targetUser.id}\`)`, inline: true });
  }

  if (messageRef) {
    const jumpUrl = `https://discord.com/channels/${interaction.guildId}/${messageRef.channelId}/${messageRef.messageId}`;
    const preview = resolvedMessage?.content
      ? resolvedMessage.content.slice(0, 500)
      : resolvedMessage
        ? '*(sin contenido de texto — puede ser un embed/adjunto)*'
        : '*(no se pudo leer — el mensaje puede haber sido borrado, o estar en un canal fuera de alcance)*';
    fields.push({ name: 'Mensaje reportado', value: `[Ir al mensaje](${jumpUrl})\n${preview}` });
  }

  fields.push({ name: 'Motivo', value: motivo });

  const embed = new EmbedBuilder()
    .setColor(LOG_COLOR)
    .setTitle('🚨 Nuevo reporte')
    .addFields(fields)
    .setFooter({ text: `${BRAND_NAME} • /report` })
    .setTimestamp();

  try {
    await reportChannel.send({ embeds: [embed] });
  } catch (error) {
    console.error('❌ No se pudo entregar un reporte al canal de staff:', error);
    await interaction.editReply({
      content: '❌ No se pudo entregar el reporte (¿el bot tiene permiso para escribir en ese canal?). Probá de nuevo o avisale a un administrador.',
    });
    return;
  }

  await interaction.editReply({ content: '✅ Reporte enviado al staff. Gracias por ayudar a mantener el servidor en orden.' });
}
