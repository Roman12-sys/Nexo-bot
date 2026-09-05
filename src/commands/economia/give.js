import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getUserEconomy, transferBalance, recordTransaction } from '../../utils/economyStore.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { createGiveSuspiciousLogEmbed } from '../../utils/logEmbeds.js';
import { getGuildLogChannel } from '../../utils/guildLogChannels.js';
import { recordGive } from '../../utils/giveTracker.js';

// Cooldown contra ejecuciones rápidas/doble click — ECO-2, Fase 4B: antes no existía
// ningún límite propio de /give (giveTracker.js solo detecta y loguea DESPUÉS del
// hecho, nunca bloquea nada). Mismo patrón y misma ventana que /encuesta/`/confession`
// (Map en memoria por guild+emisor, 2 min, barrido cada 10 min) — no reemplaza a
// giveTracker (sigue existiendo tal cual), solo sube el costo de un farmeo rápido de
// alts (N cuentas corriendo /daily+/work y volcando todo a una cuenta principal en
// ráfaga). No es un rediseño de la economía (comisión/antigüedad mínima quedan afuera
// a propósito, ver Fase 4B triage) — es el mínimo quirúrgico que cierra la ejecución en
// ráfaga sin tocar cómo se mueve la plata.
const GIVE_COOLDOWN_MS = 2 * 60 * 1000;
const lastGiveAt = new Map(); // `${guildId}:${senderId}` -> timestamp del último /give

setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of lastGiveAt) {
    if (now - ts >= GIVE_COOLDOWN_MS) lastGiveAt.delete(key);
  }
}, 10 * 60 * 1000).unref();

export const data = new SlashCommandBuilder()
  .setName('give')
  .setDescription('Transferí monedas a otro usuario.')
  .addUserOption((o) => o.setName('usuario').setDescription('A quién le transferís').setRequired(true))
  .addIntegerOption((o) => o.setName('cantidad').setDescription('Cuántas monedas').setRequired(true).setMinValue(1))
  .setDMPermission(false);

export async function execute(interaction) {
  const targetUser = interaction.options.getUser('usuario');
  const cantidad = interaction.options.getInteger('cantidad');
  const guildId = interaction.guild.id;

  const cooldownKey = `${guildId}:${interaction.user.id}`;
  const lastGive = lastGiveAt.get(cooldownKey) || 0;
  const elapsed = Date.now() - lastGive;
  if (elapsed < GIVE_COOLDOWN_MS) {
    const retryAt = Math.floor((lastGive + GIVE_COOLDOWN_MS) / 1000);
    await interaction.reply({ content: `⏳ Ya transferiste monedas hace poco. Podés volver a usar /give <t:${retryAt}:R>.`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (targetUser.id === interaction.user.id) {
    await interaction.reply({ content: '❌ No podés transferirte monedas a vos mismo.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (targetUser.bot) {
    await interaction.reply({ content: '❌ No podés transferirle monedas a un bot.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Chequeo previo ANTES de deferir: así el error de "no te alcanza" puede responderse
  // ephemeral (una vez deferido en público, ya no se puede cambiar). transferBalance
  // sigue siendo la autoridad atómica real — esto es solo para elegir cómo responder.
  const senderEconomy = await getUserEconomy(guildId, interaction.user.id);
  if (senderEconomy.balance < cantidad) {
    await interaction.reply({ content: '❌ No tenés suficientes monedas para esa transferencia.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Recién acá se consume el cooldown — un intento rechazado (a uno mismo, a un bot, o
  // sin fondos) no debería gastarle el turno a un uso legítimo posterior.
  lastGiveAt.set(cooldownKey, Date.now());

  await interaction.deferReply();

  // transferBalance hace el chequeo de fondos + resta + suma en una sola transacción
  // atómica (RPC transfer_balance) — si no alcanza, no se descuenta nada de nadie.
  let result;
  try {
    result = await transferBalance(guildId, interaction.user.id, targetUser.id, cantidad);
  } catch (error) {
    if (error.code === 'insufficient_funds') {
      await interaction.editReply({ content: '❌ No tenés suficientes monedas para esa transferencia.' });
      return;
    }
    throw error;
  }

  // allSettled en vez de all: la plata YA se movió (transferBalance es la autoridad
  // atómica real, arriba). Si el registro de historial de UNO de los dos falla acá
  // (ej. blip de red), no queremos que el usuario se quede sin la confirmación de que
  // la transferencia sí ocurrió — solo logueamos qué mitad del historial faltó.
  const transactionResults = await Promise.allSettled([
    recordTransaction(guildId, interaction.user.id, {
      type: 'transfer_out',
      amount: -cantidad,
      balanceAfter: result.senderBalance,
      actorId: interaction.user.id,
      reason: `A ${targetUser.tag}`,
    }),
    recordTransaction(guildId, targetUser.id, {
      type: 'transfer_in',
      amount: cantidad,
      balanceAfter: result.receiverBalance,
      actorId: interaction.user.id,
      reason: `De ${interaction.user.tag}`,
    }),
  ]);
  transactionResults.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`❌ Error registrando transacción de /give (${i === 0 ? 'emisor' : 'receptor'}, guild ${guildId}):`, r.reason);
    }
  });

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('💸 Transferencia realizada')
    .setDescription(`Le transferiste **${cantidad.toLocaleString('es-ES')}** monedas a ${targetUser}.`)
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });

  // Señal de patrón sospechoso (lavado entre alts / cuenta comprometida repartiendo
  // balance) — no bloquea ni avisa al usuario, solo un heads-up silencioso al staff.
  const suspiciousPattern = recordGive(guildId, interaction.user.id, targetUser.id, cantidad);
  if (suspiciousPattern) {
    const logChannel = await getGuildLogChannel(interaction.client, interaction.guildId, 'economy');
    if (logChannel) {
      await logChannel.send({
        embeds: [createGiveSuspiciousLogEmbed({ sender: interaction.user, pattern: suspiciousPattern })],
      });
    }
  }
}
