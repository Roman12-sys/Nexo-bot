import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { createReminder, getUserReminders, deleteReminder } from '../../utils/remindersStore.js';
import { scheduleReminder, cancelReminder } from '../../utils/reminderEngine.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';

const MAX_DAYS = 30;
const DURATION_REGEX = /^(\d+)\s*(m|min|minutos?|h|horas?|d|d[ií]as?)$/i;

const UNIT_TO_MS = {
  m: 60 * 1000, min: 60 * 1000, minuto: 60 * 1000, minutos: 60 * 1000,
  h: 60 * 60 * 1000, hora: 60 * 60 * 1000, horas: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000, dia: 24 * 60 * 60 * 1000, dias: 24 * 60 * 60 * 1000, día: 24 * 60 * 60 * 1000, días: 24 * 60 * 60 * 1000,
};

// "10m" / "2h" / "1d" / "3 dias" — flexible a propósito, no un choice fijo, porque un
// recordatorio personal no tiene los mismos valores típicos que un sorteo o timeout.
function parseDuration(raw) {
  const match = raw.trim().toLowerCase().match(DURATION_REGEX);
  if (!match) return null;

  const amount = parseInt(match[1], 10);
  const unitKey = match[2].replace(/s$/, '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const unitMs = UNIT_TO_MS[unitKey] || UNIT_TO_MS[match[2]];
  if (!unitMs || amount <= 0) return null;

  return amount * unitMs;
}

async function handleCrear(interaction) {
  const tiempoRaw = interaction.options.getString('tiempo');
  const mensaje = interaction.options.getString('mensaje');

  const delayMs = parseDuration(tiempoRaw);
  if (!delayMs) {
    await interaction.reply({ content: '❌ No entendí ese tiempo. Probá algo como `10m`, `2h` o `3d`.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (delayMs > MAX_DAYS * 24 * 60 * 60 * 1000) {
    await interaction.reply({ content: `❌ El máximo es ${MAX_DAYS} días.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const remindAt = Date.now() + delayMs;
  const reminder = await createReminder(interaction.guildId, interaction.user.id, mensaje, remindAt);
  scheduleReminder(interaction.client, reminder);

  const readyTimestamp = Math.floor(remindAt / 1000);
  await interaction.reply({
    content: `⏰ Listo, te aviso por DM <t:${readyTimestamp}:R> (<t:${readyTimestamp}:f>).`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleListar(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const reminders = await getUserReminders(interaction.guildId, interaction.user.id);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('⏰ Tus recordatorios pendientes')
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();

  const description =
    reminders.length === 0
      ? 'No tenés recordatorios pendientes.'
      : reminders.map((r) => `\`#${r.id}\` <t:${Math.floor(r.remindAt / 1000)}:R> — ${r.message}`).join('\n');
  embed.setDescription(description.length > 4096 ? `${description.slice(0, 4093)}...` : description);

  await interaction.editReply({ embeds: [embed] });
}

async function handleCancelar(interaction) {
  const id = interaction.options.getInteger('id');
  const reminders = await getUserReminders(interaction.guildId, interaction.user.id);
  const found = reminders.find((r) => r.id === id);

  if (!found) {
    await interaction.reply({ content: '❌ No encontré ese recordatorio (¿es tuyo? ¿ya se disparó?).', flags: MessageFlags.Ephemeral });
    return;
  }

  await deleteReminder(id);
  cancelReminder(id);
  await interaction.reply({ content: '✅ Recordatorio cancelado.', flags: MessageFlags.Ephemeral });
}

export const data = new SlashCommandBuilder()
  .setName('recordatorio')
  .setDescription('Recordatorios personales, te avisa por DM.')
  .addSubcommand((sub) =>
    sub
      .setName('crear')
      .setDescription('Crea un recordatorio nuevo.')
      .addStringOption((o) => o.setName('tiempo').setDescription('Ej: 10m, 2h, 3d (máximo 30 días)').setRequired(true))
      .addStringOption((o) => o.setName('mensaje').setDescription('Qué querés que te recuerde').setRequired(true).setMaxLength(500)),
  )
  .addSubcommand((sub) => sub.setName('listar').setDescription('Muestra tus recordatorios pendientes.'))
  .addSubcommand((sub) =>
    sub
      .setName('cancelar')
      .setDescription('Cancela un recordatorio.')
      .addIntegerOption((o) => o.setName('id').setDescription('ID del recordatorio (ver /recordatorio listar)').setRequired(true)),
  )
  .setDMPermission(false);

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'crear') return handleCrear(interaction);
  if (sub === 'listar') return handleListar(interaction);
  if (sub === 'cancelar') return handleCancelar(interaction);
}
