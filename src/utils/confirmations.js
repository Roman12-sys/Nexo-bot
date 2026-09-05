// Panel genérico de "¿Confirmás?" para acciones destructivas (/ban, /clear, /unwarn).
// Mismo patrón visual que /setup (i.update de "procesando" → i.editReply del resultado),
// pero con su propio store en memoria: acá no hay un "dueño" persistido en Supabase como
// las salas de voz temporales, así que la sesión vive en un Map keyed por un token
// opaco (crypto.randomUUID, nunca adivinable) en vez de un ID de negocio.
import { randomUUID } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { registerButtonPrefix } from '../components/buttons.js';

const CONFIRM_TTL_MS = 60 * 1000; // acción destructiva — no tiene sentido dejarla abierta más que esto
const EXPIRED_MESSAGE = '⏳ Esta confirmación expiró o ya se usó. Volvé a correr el comando.';

const pending = new Map(); // token -> { userId, guildId, run, timeoutHandle }

// Arma el panel "⚠️ Confirmar acción" + botones. `run(buttonInteraction)` es lo que se
// ejecuta SOLO si el mismo usuario que pidió la acción, en el mismo servidor, confirma
// — ahí adentro hay que revalidar lo que pueda haber cambiado desde que se mostró el
// panel (permisos, jerarquía, etc.), nunca asumir que las condiciones siguen iguales.
export function buildConfirmation({ userId, guildId, description, run }) {
  const token = randomUUID();

  const timeoutHandle = setTimeout(() => pending.delete(token), CONFIRM_TTL_MS).unref();
  pending.set(token, { userId, guildId, run, timeoutHandle });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`confirm_yes_${token}`).setLabel('Confirmar').setEmoji('✅').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`confirm_no_${token}`).setLabel('Cancelar').setEmoji('❌').setStyle(ButtonStyle.Secondary),
  );

  // allowedMentions: solo permite menciones de usuario (necesarias para interpolar
  // ${targetUser} en la description de /ban y /unwarn) — bloquea @everyone/@here y
  // menciones de rol, que nunca deberían poder colarse desde un motivo de staff
  // (ban.js interpola `motivo` libre, unwarn.js interpola `target.reason` histórico,
  // ninguno de los dos sanitizado hasta ahora). Ver SEC-2, Fase 4A.
  return { content: `⚠️ **Confirmar acción**\n${description}`, components: [row], embeds: [], allowedMentions: { parse: ['users'] } };
}

function ownerMismatch(interaction, session) {
  return interaction.user.id !== session.userId || interaction.guildId !== session.guildId;
}

async function replyExpired(interaction) {
  await interaction.update({ content: EXPIRED_MESSAGE, embeds: [], components: [] }).catch(() =>
    interaction.reply({ content: EXPIRED_MESSAGE, flags: MessageFlags.Ephemeral }).catch(() => {}),
  );
}

async function handleConfirm(interaction, token) {
  // Primero solo MIRA la sesión (no la saca) para poder distinguir "no es tuya" (el
  // dueño real todavía puede confirmarla después) de "ya no existe" (expiró o alguien
  // ya la usó). Recién se saca del Map una vez confirmado que es el dueño correcto —
  // eso, sin ningún await en el medio, es lo que evita la doble ejecución: un segundo
  // click (doble click, o dos casi simultáneos) siempre encuentra el Map ya vacío.
  const session = pending.get(token);
  if (!session) return replyExpired(interaction);
  if (ownerMismatch(interaction, session)) {
    return interaction.reply({ content: '❌ Esta confirmación no es tuya.', flags: MessageFlags.Ephemeral });
  }

  if (!pending.delete(token)) return replyExpired(interaction);
  clearTimeout(session.timeoutHandle);

  await session.run(interaction);
}

async function handleCancel(interaction, token) {
  const session = pending.get(token);
  if (!session) return replyExpired(interaction);
  if (ownerMismatch(interaction, session)) {
    return interaction.reply({ content: '❌ Esta confirmación no es tuya.', flags: MessageFlags.Ephemeral });
  }

  if (!pending.delete(token)) return replyExpired(interaction);
  clearTimeout(session.timeoutHandle);

  await interaction.update({ content: '❌ Acción cancelada.', embeds: [], components: [] });
}

registerButtonPrefix('confirm_yes_', (i) => handleConfirm(i, i.customId.slice('confirm_yes_'.length)));
registerButtonPrefix('confirm_no_', (i) => handleCancel(i, i.customId.slice('confirm_no_'.length)));
