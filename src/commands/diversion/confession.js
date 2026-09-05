import { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import { getNextConfessionNumber } from '../../utils/confessionStore.js';
import { getGuildConfig } from '../../utils/guildConfigStore.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';
import { isStaff } from '../../utils/permissions.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { registerModalPrefix } from '../../components/modals.js';
import { registerButtonPrefix } from '../../components/buttons.js';
import { unlockAchievement, buildAchievementUnlockedEmbed } from '../../utils/achievements.js';

function buildConfessionModal() {
  const modal = new ModalBuilder().setCustomId('modal_confession').setTitle('Confesión anónima');
  const mensaje = new TextInputBuilder()
    .setCustomId('mensaje')
    .setLabel('Tu confesión (se publica de forma anónima)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000);
  modal.addComponents(new ActionRowBuilder().addComponents(mensaje));
  return modal;
}

// Confesiones enviadas a revisión (guild_config.confession_require_approval) — viven acá
// en memoria porque todavía no se publicaron en ningún lado (no hay un mensaje real del
// que colgar el estado), mismo criterio que las sesiones de /anuncio o /setup. 24hs es
// tiempo de sobra para que el staff las revise; si nadie las toca, se pierden solas.
const pendingConfessions = new Map(); // `${guildId}:${number}` -> { authorId, message, timeoutHandle }
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

// Cooldown contra spam — MOD-4, Fase 4B: antes no existía ningún límite (a diferencia de
// /encuesta, que ya tenía este mismo fix aplicado desde Fase 2B). El vector es peor acá
// que en /encuesta: contenido anónimo público, así que "quién lo mandó" no sirve de
// disuasivo social. Mismo patrón exacto (Map en memoria por guild+usuario, ventana de 2
// min, barrido cada 10 min) — se chequea y consume en execute() (antes de mostrar el
// modal), no en el submit: así un usuario en cooldown ni siquiera pierde tiempo
// escribiendo una confesión que después no se va a publicar.
const CONFESSION_COOLDOWN_MS = 2 * 60 * 1000;
const lastConfessionAt = new Map(); // `${guildId}:${userId}` -> timestamp del último /confession

setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of lastConfessionAt) {
    if (now - ts >= CONFESSION_COOLDOWN_MS) lastConfessionAt.delete(key);
  }
}, 10 * 60 * 1000).unref();

export const data = new SlashCommandBuilder()
  .setName('confession')
  .setDescription('Enviá una confesión anónima al canal de confesiones.')
  .setDMPermission(false);

export async function execute(interaction) {
  const cfg = await getGuildConfig(interaction.guildId);
  if ((cfg.confession_blocked_ids || []).includes(interaction.user.id)) {
    await interaction.reply({ content: '❌ No podés usar /confession en este servidor.', flags: MessageFlags.Ephemeral });
    return;
  }

  const cooldownKey = `${interaction.guildId}:${interaction.user.id}`;
  const lastConfession = lastConfessionAt.get(cooldownKey) || 0;
  const elapsed = Date.now() - lastConfession;
  if (elapsed < CONFESSION_COOLDOWN_MS) {
    const retryAt = Math.floor((lastConfession + CONFESSION_COOLDOWN_MS) / 1000);
    await interaction.reply({ content: `⏳ Ya mandaste una confesión hace poco. Podés mandar otra <t:${retryAt}:R>.`, flags: MessageFlags.Ephemeral });
    return;
  }

  // Recién acá se consume el cooldown — un intento bloqueado por confession_blocked_ids
  // (arriba) ya cortó antes de llegar, así que no hace falta un caso especial para eso.
  lastConfessionAt.set(cooldownKey, Date.now());

  await interaction.showModal(buildConfessionModal());
}

registerModalPrefix('modal_confession', async (i) => {
  const cfg = await getGuildConfig(i.guildId);
  if (!cfg.confession_channel_id) {
    await i.reply({ content: '⚠️ El canal de confesiones no está configurado. Un admin puede activarlo con `/config canal-confesiones`.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Revalidado acá también (no solo en execute() antes del modal): el staff pudo
  // haber bloqueado a este usuario mientras tenía el modal abierto.
  if ((cfg.confession_blocked_ids || []).includes(i.user.id)) {
    await i.reply({ content: '❌ No podés usar /confession en este servidor.', flags: MessageFlags.Ephemeral });
    return;
  }

  const mensaje = i.fields.getTextInputValue('mensaje');
  const confessionChannel = await i.client.channels.fetch(cfg.confession_channel_id).catch(() => null);
  if (!confessionChannel || !confessionChannel.isTextBased()) {
    await i.reply({ content: '⚠️ No se pudo acceder al canal de confesiones.', flags: MessageFlags.Ephemeral });
    return;
  }

  const number = await getNextConfessionNumber(i.guildId);

  if (cfg.confession_require_approval) {
    const modChannel = await getGuildLogChannel(i.client, i.guildId, 'moderation');
    if (!modChannel) {
      await i.reply({
        content: '⚠️ Este servidor pide revisión previa de las confesiones, pero no tiene canal de logs de moderación configurado — avisale a un admin.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const timeoutHandle = setTimeout(() => pendingConfessions.delete(`${i.guildId}:${number}`), PENDING_TTL_MS).unref();
    pendingConfessions.set(`${i.guildId}:${number}`, { authorId: i.user.id, message: mensaje, timeoutHandle });

    const reviewEmbed = new EmbedBuilder()
      .setColor('#E9C46A')
      .setTitle(`🕵️ Confesión #${number} — pendiente de revisión`)
      .setDescription(mensaje)
      .addFields({ name: 'Autor real', value: `${i.user.tag} (\`${i.user.id}\`)` })
      .setFooter({ text: `${BRAND_NAME} • Solo vos la ves así — se publica anónima si se aprueba` })
      .setTimestamp();
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`confession_approve_${i.guildId}_${number}`).setLabel('Aprobar').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`confession_reject_${i.guildId}_${number}`).setLabel('Rechazar').setEmoji('❌').setStyle(ButtonStyle.Danger),
    );
    await modChannel.send({ embeds: [reviewEmbed], components: [row] });

    await i.reply({ content: '📨 Tu confesión se mandó a revisión del staff — se publica (o no) según lo que decidan.', flags: MessageFlags.Ephemeral });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`🤫 Confesión #${number}`)
    .setDescription(mensaje)
    .setFooter({ text: `${BRAND_NAME} • Anónimo` })
    .setTimestamp();

  await confessionChannel.send({ embeds: [embed] });

  const logChannel = await getGuildLogChannel(i.client, i.guildId, 'moderation');
  if (logChannel) {
    const logEmbed = new EmbedBuilder()
      .setColor('#6C757D')
      .setTitle(`🔒 Registro privado — Confesión #${number}`)
      .setDescription('Solo para moderación. La confesión se publicó de forma anónima en el canal público.')
      .addFields({ name: 'Autor real', value: `${i.user.tag} (\`${i.user.id}\`)` })
      .setTimestamp();
    await logChannel.send({ embeds: [logEmbed] });
  }

  // Ephemeral y manual a propósito (no announceUnlockedAchievements): ese helper manda
  // un followUp PÚBLICO, y eso deanonimizaría a quien confesó — todo lo relacionado a
  // este logro tiene que quedar visible solo para el autor real.
  const achievement = await unlockAchievement(i.guildId, i.user.id, 'primera_confesion').catch(() => null);
  await i.reply({
    content: '✅ Tu confesión fue publicada de forma anónima.',
    embeds: achievement ? [buildAchievementUnlockedEmbed(i.user, achievement)] : [],
    flags: MessageFlags.Ephemeral,
  });
});

registerButtonPrefix('confession_approve_', async (i) => {
  if (!(await isStaff(i))) return i.reply({ content: '❌ No tenés permisos.', flags: MessageFlags.Ephemeral });

  const [guildId, numero] = i.customId.slice('confession_approve_'.length).split('_');
  const key = `${guildId}:${numero}`;
  const pending = pendingConfessions.get(key);
  if (!pending) {
    return i.update({ content: '⚠️ Esta confesión ya fue procesada o expiró.', embeds: [], components: [] });
  }
  pendingConfessions.delete(key);
  clearTimeout(pending.timeoutHandle);

  const cfg = await getGuildConfig(guildId);
  const confessionChannel = await i.client.channels.fetch(cfg.confession_channel_id).catch(() => null);
  if (!confessionChannel) {
    return i.update({ content: '❌ El canal de confesiones ya no existe.', embeds: [], components: [] });
  }

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`🤫 Confesión #${numero}`)
    .setDescription(pending.message)
    .setFooter({ text: `${BRAND_NAME} • Anónimo` })
    .setTimestamp();
  await confessionChannel.send({ embeds: [embed] });

  // El logro sigue silencioso acá (quien aprueba es staff, no el autor — no hay forma de
  // anunciarlo en el canal SIN deanonimizar), pero el DM de abajo es distinto: un DM es
  // 1:1, solo lo ve el autor real, así que avisar por ahí no rompe el anonimato ante nadie.
  await unlockAchievement(guildId, pending.authorId, 'primera_confesion').catch(() => {});

  const author = await i.client.users.fetch(pending.authorId).catch(() => null);
  if (author) {
    await author
      .send(`✅ Tu confesión #${numero} fue **aprobada** por el staff y ya está publicada de forma anónima.`)
      .catch(() => {}); // el usuario puede tener los DMs cerrados — no es un error real
  }

  await i.update({ content: `✅ Confesión #${numero} aprobada y publicada por ${i.user.tag}.`, embeds: [], components: [] });
});

registerButtonPrefix('confession_reject_', async (i) => {
  if (!(await isStaff(i))) return i.reply({ content: '❌ No tenés permisos.', flags: MessageFlags.Ephemeral });

  const [guildId, numero] = i.customId.slice('confession_reject_'.length).split('_');
  const key = `${guildId}:${numero}`;
  const pending = pendingConfessions.get(key);
  if (pending) {
    pendingConfessions.delete(key);
    clearTimeout(pending.timeoutHandle);

    // Mismo criterio que en la aprobación: un DM es 1:1, avisar por ahí no deanonimiza
    // nada. Antes quien confesaba nunca se enteraba de si fue vista o simplemente ignorada.
    const author = await i.client.users.fetch(pending.authorId).catch(() => null);
    if (author) {
      await author.send(`❌ Tu confesión #${numero} fue **rechazada** por el staff. No se publicó.`).catch(() => {});
    }
  }

  await i.update({ content: `❌ Confesión #${numero} rechazada por ${i.user.tag}. No se publicó.`, embeds: [], components: [] });
});
