import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { registerButtonPrefix } from '../components/buttons.js';
import { withLock } from './asyncLock.js';
import { fetchAllMembers } from './sanctions.js';
import { joinWithOverflow } from './logEmbeds.js';
import { SUCCESS_COLOR, WARN_COLOR } from './embeds.js';

// Confirmación de lectura de normativas: un mensaje con "✅ Leídas" / "❌ No leídas" que
// se actualiza en cada click. Quién leyó vive en el propio embed (nunca en Supabase) —
// mismo criterio que tuvo /report: el mensaje sobrevive solo a un restart y el botón se
// re-registra en cada boot. "Sin leer" no se guarda: se recalcula en cada click contra
// quién puede ver el canal hoy, así nunca queda desactualizado si alguien entra o se va.
// Lo publica el operador por REST (sin comando propio); este archivo solo atiende el botón.

export const READ_BUTTON_ID = 'readreceipt_read';
export const UNREAD_BUTTON_ID = 'readreceipt_unread';

const INTRO = 'Tocá **✅ Leídas** cuando termines de leer las normativas de arriba. Si te equivocaste, **❌ No leídas** te saca de la lista.';
const READ_HEADER = '**✅ Leídas';
const DESCRIPTION_LIMIT = 4096;

// Solo se leen las menciones que están DESPUÉS del encabezado de "Leídas", así un
// texto de intro con una mención nunca se cuenta como lector.
export function parseReadIds(embed) {
  const description = embed?.description ?? '';
  const idx = description.indexOf(READ_HEADER);
  if (idx === -1) return [];
  return [...new Set([...description.slice(idx).matchAll(/<@!?(\d+)>/g)].map((m) => m[1]))];
}

function buildDescription(readIds) {
  const list = readIds.length ? readIds.map((id) => `<@${id}>`).join(' ') : '*Nadie todavía.*';
  return `${INTRO}\n\n${READ_HEADER} (${readIds.length})**\n${list}`;
}

export function buildReadReceiptMessage(readIds, pendingIds) {
  const embed = new EmbedBuilder()
    .setColor(pendingIds.length ? WARN_COLOR : SUCCESS_COLOR)
    .setTitle('📋 Confirmación de lectura')
    .setDescription(buildDescription(readIds))
    .addFields({
      name: `⏳ Sin leer (${pendingIds.length})`,
      value: pendingIds.length ? joinWithOverflow(pendingIds.map((id) => `<@${id}>`), { sep: ' ' }) : '🎉 Todos leyeron.',
    });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(READ_BUTTON_ID).setLabel('Leídas').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(UNREAD_BUTTON_ID).setLabel('No leídas').setEmoji('❌').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

export async function computePendingIds(channel, readIds) {
  const read = new Set(readIds);
  const members = await fetchAllMembers(channel.guild);
  return [...members.values()]
    .filter((m) => !m.user.bot && !read.has(m.id) && channel.permissionsFor(m)?.has(PermissionFlagsBits.ViewChannel))
    .map((m) => m.id);
}

async function handleClick(interaction, markRead) {
  await interaction.deferUpdate();
  const userId = interaction.user.id;
  // Lock por mensaje: dos clicks casi simultáneos leerían la misma lista y el último
  // pisaría al primero. Se relee el mensaje fresco DENTRO del lock por eso mismo.
  await withLock(`readreceipt:${interaction.message.id}`, async () => {
    const message = await interaction.message.fetch();
    const readIds = parseReadIds(message.embeds[0]);
    const wasRead = readIds.includes(userId);
    const next = markRead ? (wasRead ? readIds : [...readIds, userId]) : readIds.filter((id) => id !== userId);

    if (buildDescription(next).length > DESCRIPTION_LIMIT) {
      await interaction.followUp({ content: '⚠️ La lista de lectura está llena. Avisale a un superior.', flags: MessageFlags.Ephemeral });
      return;
    }

    const pending = await computePendingIds(interaction.channel, next);
    await interaction.editReply(buildReadReceiptMessage(next, pending));

    let content;
    if (markRead) content = wasRead ? 'Ya estabas en la lista de **leídas**.' : '✅ Quedaste marcado como que **leíste** las normativas.';
    else content = wasRead ? '❌ Te saqué de la lista de leídas.' : 'No estabas en la lista de leídas.';
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
  });
}

registerButtonPrefix(READ_BUTTON_ID, (i) => handleClick(i, true));
registerButtonPrefix(UNREAD_BUTTON_ID, (i) => handleClick(i, false));
