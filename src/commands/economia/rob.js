// Único comando que le hace perder monedas a OTRO usuario sin que lo pida — por eso
// solo puede tocar el wallet (nunca el banco, ver bank.js) y tiene protección para la
// víctima: después de un intento (gane o pierda quien roba) queda a salvo un rato.
import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getUserEconomy, robWallet, setRobCooldowns, transferBalance, recordTransaction } from '../../utils/economyStore.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { withLock } from '../../utils/asyncLock.js';

const ROB_COOLDOWN_MS = 60 * 60 * 1000; // 1 hora entre intentos, por quien roba
const VICTIM_PROTECTION_MS = 3 * 60 * 60 * 1000; // 3 horas de protección después de un intento (gane o pierda quien robó)
const SUCCESS_CHANCE = 0.4;
const STEAL_PERCENT_MIN = 0.1;
const STEAL_PERCENT_MAX = 0.25;
const STEAL_MAX_AMOUNT = 5000;
const FINE_PERCENT_MIN = 0.05;
const FINE_PERCENT_MAX = 0.15;
const FINE_MAX_AMOUNT = 2000;
const MIN_VICTIM_WALLET = 100; // no vale la pena robar a alguien con menos que esto

export const data = new SlashCommandBuilder()
  .setName('rob')
  .setDescription('Intentá robarle monedas del wallet a otro usuario. 40% de éxito, con riesgo de multa si fallás.')
  .addUserOption((o) => o.setName('usuario').setDescription('A quién intentás robarle').setRequired(true))
  .setDMPermission(false);

export async function execute(interaction) {
  const targetUser = interaction.options.getUser('usuario');
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  if (targetUser.id === userId) {
    await interaction.reply({ content: '❌ No te podés robar a vos mismo.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (targetUser.bot) {
    await interaction.reply({ content: '❌ No le podés robar a un bot.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Chequeo previo ANTES de deferir (mismo criterio que /daily/crime): permite responder
  // ephemeral si está todo en cooldown, sin arriesgar la ventana de 3s de Discord con el
  // round-trip a Supabase. NO es el chequeo autoritativo — dos /rob casi simultáneos
  // (mismo atacante, o dos atacantes contra la misma víctima) pueden leer acá el mismo
  // estado "viejo" antes de que ninguno haya escrito nada todavía. El chequeo real pasa
  // DENTRO del lock, más abajo, sobre datos releídos en fresco.
  const [robber, victim] = await Promise.all([getUserEconomy(guildId, userId), getUserEconomy(guildId, targetUser.id)]);
  const preCheckNow = Date.now();

  if (preCheckNow - robber.lastRob < ROB_COOLDOWN_MS) {
    const readyTimestamp = Math.floor((robber.lastRob + ROB_COOLDOWN_MS) / 1000);
    await interaction.reply({ content: `⏳ Todavía estás escondiéndote de tu último robo. Podés volver a intentar <t:${readyTimestamp}:R>.`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (preCheckNow - victim.lastRobbed < VICTIM_PROTECTION_MS) {
    await interaction.reply({ content: `🛡️ ${targetUser.tag} está protegido — alguien ya intentó robarle hace poco.`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (victim.robShieldUntil > preCheckNow) {
    await interaction.reply({ content: `🛡️ ${targetUser.tag} tiene un escudo anti-robo activo hasta <t:${Math.floor(victim.robShieldUntil / 1000)}:R>.`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (victim.balance < MIN_VICTIM_WALLET) {
    await interaction.reply({ content: `❌ ${targetUser.tag} no tiene suficiente en el wallet como para que valga la pena robarle.`, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply();

  // Dos locks anidados, siempre en el MISMO orden (atacante afuera, víctima adentro):
  // el lock del atacante (namespace `rob:`) solo serializaba ejecuciones del MISMO
  // atacante entre sí — no protegía a la víctima contra DOS ATACANTES DISTINTOS
  // robándole casi al mismo tiempo, que podían leer el mismo estado "sin protección"
  // antes de que cualquiera de los dos escribiera el cooldown de víctima. El lock de
  // víctima (namespace `rob-victim:`, siempre por dentro del de atacante) cierra ese
  // hueco: cualquier /rob contra la MISMA víctima queda serializado sin importar quién
  // ataque. Los dos namespaces nunca comparten string con el mismo id (prefijos
  // distintos) y el orden de adquisición es siempre el mismo en todo el archivo, así
  // que no puede formarse un ciclo de espera entre dos /rob concurrentes con roles
  // cruzados (A ataca a B mientras B ataca a A) — ver auditoría adversarial round 2,
  // Bloque 3.
  await withLock(`rob:${guildId}:${userId}`, () =>
    withLock(`rob-victim:${guildId}:${targetUser.id}`, async () => {
      // Chequeo AUTORITATIVO: releído en fresco DENTRO de ambos locks — sin esto, la
      // segunda ejecución en cola (nunca rechazada, solo esperando) terminaría
      // robando de nuevo ignorando el cooldown/protección que la primera ya dejó
      // escrito. Mismo patrón que /daily y /crime.
      const [freshRobber, freshVictim] = await Promise.all([getUserEconomy(guildId, userId), getUserEconomy(guildId, targetUser.id)]);
      const now = Date.now();

      if (now - freshRobber.lastRob < ROB_COOLDOWN_MS) {
        const readyTimestamp = Math.floor((freshRobber.lastRob + ROB_COOLDOWN_MS) / 1000);
        await interaction.editReply({ content: `⏳ Todavía estás escondiéndote de tu último robo. Podés volver a intentar <t:${readyTimestamp}:R>.` });
        return;
      }
      if (now - freshVictim.lastRobbed < VICTIM_PROTECTION_MS) {
        await interaction.editReply({ content: `🛡️ ${targetUser.tag} está protegido — alguien ya intentó robarle hace poco.` });
        return;
      }
      if (freshVictim.robShieldUntil > now) {
        await interaction.editReply({ content: `🛡️ ${targetUser.tag} tiene un escudo anti-robo activo hasta <t:${Math.floor(freshVictim.robShieldUntil / 1000)}:R>.` });
        return;
      }

      // Cooldowns se fijan SIEMPRE que hay un intento real (gane o pierda) — el
      // acecho en sí ya "gasta" el turno, no solo un robo exitoso.
      await setRobCooldowns(guildId, { robberId: userId, robberTimestamp: now, victimId: targetUser.id, victimTimestamp: now });

      const exito = Math.random() < SUCCESS_CHANCE;

      if (exito) {
        const percent = STEAL_PERCENT_MIN + Math.random() * (STEAL_PERCENT_MAX - STEAL_PERCENT_MIN);
        let result;
        try {
          result = await robWallet(guildId, userId, targetUser.id, percent, STEAL_MAX_AMOUNT);
        } catch (error) {
          if (error.code === 'nothing_to_steal') {
            await interaction.editReply({ content: `❌ ${targetUser.tag} no tenía nada que robarle en el momento justo.` });
            return;
          }
          throw error;
        }
        await recordTransaction(guildId, userId, { type: 'rob_win', amount: result.stolen, balanceAfter: result.robberBalance, reason: `Le robaste a ${targetUser.tag}` });
        await recordTransaction(guildId, targetUser.id, { type: 'rob_loss', amount: -result.stolen, balanceAfter: result.victimBalance, actorId: userId, reason: `${interaction.user.tag} te robó` });

        const embed = new EmbedBuilder()
          .setColor(BRAND_COLOR)
          .setTitle('🥷 ¡Robo exitoso!')
          .setDescription(`Le robaste **${result.stolen.toLocaleString('es-ES')}** monedas a ${targetUser}.\nTu wallet: **${result.robberBalance.toLocaleString('es-ES')}**.`)
          .setFooter({ text: BRAND_NAME })
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // Fallaste: pagás una multa a la víctima. Si ni siquiera te alcanza para la multa
      // completa, transferBalance rechaza y simplemente no se cobra nada — ya perdiste
      // el intento, no hace falta además dejarte en deuda.
      const finePercent = FINE_PERCENT_MIN + Math.random() * (FINE_PERCENT_MAX - FINE_PERCENT_MIN);
      const fine = Math.min(FINE_MAX_AMOUNT, Math.floor(freshRobber.balance * finePercent));

      let fineCharged = 0;
      if (fine > 0) {
        try {
          const transferResult = await transferBalance(guildId, userId, targetUser.id, fine);
          fineCharged = fine;
          await Promise.all([
            recordTransaction(guildId, userId, { type: 'rob_fine', amount: -fine, balanceAfter: transferResult.senderBalance, reason: `Multa por intentar robarle a ${targetUser.tag}` }),
            recordTransaction(guildId, targetUser.id, { type: 'rob_fine', amount: fine, balanceAfter: transferResult.receiverBalance, actorId: userId, reason: `Multa de ${interaction.user.tag} por intentar robarte` }),
          ]);
        } catch (error) {
          if (error.code !== 'insufficient_funds') throw error;
        }
      }

      const embed = new EmbedBuilder()
        .setColor('#c22b3f')
        .setTitle('🚨 Te agarraron')
        .setDescription(
          fineCharged > 0
            ? `Te descubrieron robando a ${targetUser} — pagaste **${fineCharged.toLocaleString('es-ES')}** monedas de multa.`
            : `Te descubrieron robando a ${targetUser}, pero no tenías nada para pagar de multa.`,
        )
        .setFooter({ text: BRAND_NAME })
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    }),
  );
}
