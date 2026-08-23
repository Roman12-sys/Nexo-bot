import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getSession, startSession, clearSession } from '../../utils/guessSessions.js';
import { addBalance } from '../../utils/economyStore.js';
import { unlockAchievement, announceUnlockedAchievements } from '../../utils/achievements.js';

const MIN_NUMBER = 1;
const MAX_NUMBER = 100;

export const data = new SlashCommandBuilder()
  .setName('guess')
  .setDescription('Adiviná un número secreto entre 1 y 100.')
  .addIntegerOption((o) =>
    o.setName('numero').setDescription('Tu número entre 1 y 100').setRequired(true).setMinValue(MIN_NUMBER).setMaxValue(MAX_NUMBER),
  )
  .setDMPermission(false);

export async function execute(interaction) {
  const key = `${interaction.guild.id}:${interaction.user.id}`;
  let session = getSession(key);

  // Si no había una partida activa para vos, arrancamos una (el bot elige un número secreto)
  if (!session) {
    const secret = Math.floor(Math.random() * (MAX_NUMBER - MIN_NUMBER + 1)) + MIN_NUMBER;
    startSession(key, secret);
    session = getSession(key);
  }

  session.attempts += 1;
  session.updatedAt = Date.now();
  const numero = interaction.options.getInteger('numero');

  if (numero === session.secret) {
    // Solo este camino llama a Supabase (addBalance) antes de responder — se difiere
    // acá nomás, para no meterle latencia extra a las dos ramas rápidas de abajo.
    await interaction.deferReply();

    // Menos intentos = más premio (mínimo 10, máximo 45 — el máximo real es en el 1er intento: 50-1*5)
    const reward = Math.max(10, 50 - session.attempts * 5);
    const attemptsUsed = session.attempts;
    const newBalance = await addBalance(interaction.guild.id, interaction.user.id, reward, { type: 'guess', reason: `${attemptsUsed} intento(s)` });
    clearSession(key);

    await interaction.editReply({
      content: `🎉 ¡Correcto! El número era **${numero}**. Lo lograste en **${attemptsUsed}** intento(s).\nGanaste **${reward}** monedas. Balance: **${newBalance}**.`,
    });

    if (attemptsUsed === 1) {
      await announceUnlockedAchievements(interaction, interaction.user.id, [
        unlockAchievement(interaction.guild.id, interaction.user.id, 'racha_perfecta'),
      ]);
    }
    return;
  }

  if (numero < session.secret) {
    await interaction.reply({ content: `⬆️ Más alto. (Intento #${session.attempts})`, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({ content: `⬇️ Más bajo. (Intento #${session.attempts})`, flags: MessageFlags.Ephemeral });
}
