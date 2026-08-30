import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { createReminder, getUserReminders, deleteReminder, getUserActiveReminderCount } from '../../utils/remindersStore.js';
import { scheduleReminder, cancelReminder } from '../../utils/reminderEngine.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { registerButtonPrefix } from '../../components/buttons.js';

const PAGE_SIZE = 10;

function buildReminderEmbed(reminders, page) {
  const totalPages = Math.max(1, Math.ceil(reminders.length / PAGE_SIZE));
  const clampedPage = Math.min(Math.max(0, page), totalPages - 1);
  const slice = reminders.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('⏰ Tus recordatorios pendientes')
    .setFooter({ text: `${BRAND_NAME} • Página ${clampedPage + 1}/${totalPages}` })
    .setTimestamp();

  embed.setDescription(
    reminders.length === 0
      ? 'No tenés recordatorios pendientes.'
      : slice
          .map((r) => `\`#${r.id}\` <t:${Math.floor(r.remindAt / 1000)}:R> — ${r.message}${r.repeatMs ? ` 🔁 ${REPEAT_LABELS[r.repeatMs] || 'recurrente'}` : ''}`)
          .join('\n'),
  );

  return { embed, clampedPage, totalPages };
}

function buildReminderRow(userId, clampedPage, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`recordatorio_page_${clampedPage - 1}_${userId}`)
      .setLabel('◀️ Anterior')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clampedPage <= 0),
    new ButtonBuilder()
      .setCustomId(`recordatorio_page_${clampedPage + 1}_${userId}`)
      .setLabel('Siguiente ▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clampedPage >= totalPages - 1),
  );
}

// QUÉ CAMBIÓ: constante nueva REMINDER_LIMIT_PER_USER + chequeo en handleCrear.
// MOTIVO: auditoría 2026-08-29 (Diagnóstico Nexo, Parte 22) — sin límite, un usuario
// podía acumular recordatorios pendientes sin ningún tope.
// VERIFICACIÓN: /recordatorio crear x10 anda bien, el 11º responde "❌ Ya tenés 10...".
const REMINDER_LIMIT_PER_USER = 10;

const MAX_DAYS = 30;
const DURATION_REGEX = /^(\d+)\s*(m|min|minutos?|h|horas?|d|d[ií]as?)$/i;

const REPEAT_MS = { diario: 24 * 60 * 60 * 1000, semanal: 7 * 24 * 60 * 60 * 1000 };
const REPEAT_LABELS = { [REPEAT_MS.diario]: 'diario', [REPEAT_MS.semanal]: 'semanal' };

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
  const repetir = interaction.options.getString('repetir');
  const repeatMs = repetir ? REPEAT_MS[repetir] : null;

  const delayMs = parseDuration(tiempoRaw);
  if (!delayMs) {
    await interaction.reply({ content: '❌ No entendí ese tiempo. Probá algo como `10m`, `2h` o `3d`.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (delayMs > MAX_DAYS * 24 * 60 * 60 * 1000) {
    await interaction.reply({ content: `❌ El máximo es ${MAX_DAYS} días.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const activeCount = await getUserActiveReminderCount(interaction.guildId, interaction.user.id);
  if (activeCount >= REMINDER_LIMIT_PER_USER) {
    await interaction.reply({
      content: `❌ Ya tenés ${REMINDER_LIMIT_PER_USER} recordatorios activos. Cancelá alguno con \`/recordatorio cancelar\` antes de crear otro.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const remindAt = Date.now() + delayMs;
  const reminder = await createReminder(interaction.guildId, interaction.user.id, mensaje, remindAt, repeatMs);
  scheduleReminder(interaction.client, reminder);

  const readyTimestamp = Math.floor(remindAt / 1000);
  const repeatText = repeatMs ? ` Se repite ${repetir === 'diario' ? 'todos los días' : 'todas las semanas'} después de eso.` : '';
  await interaction.reply({
    content: `⏰ Listo, te aviso por DM <t:${readyTimestamp}:R> (<t:${readyTimestamp}:f>).${repeatText}`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleListar(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const reminders = await getUserReminders(interaction.guildId, interaction.user.id);

  const { embed, clampedPage, totalPages } = buildReminderEmbed(reminders, 0);
  const components = reminders.length > PAGE_SIZE ? [buildReminderRow(interaction.user.id, clampedPage, totalPages)] : [];
  await interaction.editReply({ embeds: [embed], components });
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
      .addStringOption((o) => o.setName('mensaje').setDescription('Qué querés que te recuerde').setRequired(true).setMaxLength(500))
      .addStringOption((o) =>
        o
          .setName('repetir')
          .setDescription('Repetir automáticamente después del primer aviso (opcional)')
          .setRequired(false)
          .addChoices({ name: 'Diario', value: 'diario' }, { name: 'Semanal', value: 'semanal' }),
      ),
  )
  .addSubcommand((sub) => sub.setName('listar').setDescription('Muestra tus recordatorios pendientes.'))
  .addSubcommand((sub) =>
    sub
      .setName('cancelar')
      .setDescription('Cancela un recordatorio.')
      .addIntegerOption((o) => o.setName('id').setDescription('ID del recordatorio (escribí para buscar)').setRequired(true).setAutocomplete(true)),
  )
  .setDMPermission(false);

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'crear') return handleCrear(interaction);
  if (sub === 'listar') return handleListar(interaction);
  if (sub === 'cancelar') return handleCancelar(interaction);
}

export async function autocomplete(interaction) {
  const reminders = await getUserReminders(interaction.guildId, interaction.user.id).catch(() => []);
  const matches = reminders.slice(0, 25).map((r) => ({ name: `#${r.id} — ${r.message}`.slice(0, 100), value: r.id }));
  await interaction.respond(matches);
}

registerButtonPrefix('recordatorio_page_', async (interaction) => {
  const [pageRaw, userId] = interaction.customId.slice('recordatorio_page_'.length).split('_');
  // Ephemeral: solo quien lo pidió puede llegar a ver/clickear este botón, pero se
  // valida igual — mismo criterio que el resto de los paneles del proyecto.
  if (interaction.user.id !== userId) {
    return interaction.reply({ content: '❌ Esto no es tuyo.', flags: MessageFlags.Ephemeral });
  }

  const reminders = await getUserReminders(interaction.guildId, userId);
  const { embed, clampedPage, totalPages } = buildReminderEmbed(reminders, parseInt(pageRaw, 10));
  await interaction.update({ embeds: [embed], components: [buildReminderRow(userId, clampedPage, totalPages)] });
});
