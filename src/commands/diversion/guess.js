import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getSession, startSession, clearSession } from '../../utils/guessSessions.js';
import { addBalance } from '../../utils/economyStore.js';
import { unlockAchievement, announceUnlockedAchievements } from '../../utils/achievements.js';
import { withLock } from '../../utils/asyncLock.js';

const MIN_NUMBER = 1;
const MAX_NUMBER = 100;

// Sin esto, con búsqueda binaria óptima (~7 intentos para 100 números) se podía cobrar
// moneda garantizada de forma indefinida, sin ningún cooldown — a diferencia de /daily,
// /work y /trivia, que sí tienen uno. Se cuentan PARTIDAS NUEVAS (no intentos): una vez
// que arrancaste una, la podés seguir intentando hasta acertarla sin que cuente de nuevo.
const MAX_GAMES_PER_WINDOW = 5;
const GAMES_WINDOW_MS = 24 * 60 * 60 * 1000;
const gamesStarted = new Map(); // key (guild:user) -> timestamps[] de partidas nuevas iniciadas

function canStartNewGame(key) {
  const now = Date.now();
  const timestamps = (gamesStarted.get(key) || []).filter((t) => now - t < GAMES_WINDOW_MS);
  gamesStarted.set(key, timestamps);
  if (timestamps.length >= MAX_GAMES_PER_WINDOW) {
    return { allowed: false, resetAt: timestamps[0] + GAMES_WINDOW_MS };
  }
  return { allowed: true };
}

function registerNewGame(key) {
  const timestamps = gamesStarted.get(key) || [];
  timestamps.push(Date.now());
  gamesStarted.set(key, timestamps);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of gamesStarted) {
    const fresh = timestamps.filter((t) => now - t < GAMES_WINDOW_MS);
    if (fresh.length === 0) gamesStarted.delete(key);
    else gamesStarted.set(key, fresh);
  }
}, 5 * 60 * 1000).unref();

export const data = new SlashCommandBuilder()
  .setName('guess')
  .setDescription('Adiviná un número secreto entre 1 y 100.')
  .addIntegerOption((o) =>
    o.setName('numero').setDescription('Tu número entre 1 y 100').setRequired(true).setMinValue(MIN_NUMBER).setMaxValue(MAX_NUMBER),
  )
  .setDMPermission(false);

export async function execute(interaction) {
  const key = `${interaction.guild.id}:${interaction.user.id}`;

  // Todo el flujo (leer/crear sesión, sumar intento, pagar si acertó) va bajo lock por
  // usuario+server — sin esto, dos /guess casi simultáneos con el número correcto
  // comparten la misma sesión y ambos pasan el chequeo antes de que ninguno la limpie,
  // pagando el premio dos veces por un solo acierto.
  const result = await withLock(`guess:${key}`, async () => {
    let session = getSession(key);

    // Si no había una partida activa para vos, arrancamos una (el bot elige un número
    // secreto) — pero antes chequeamos el tope diario de partidas NUEVAS, adentro del
    // lock para que dos /guess casi simultáneos no se cuelen los dos antes de que
    // ninguno registre la partida.
    if (!session) {
      const gameCheck = canStartNewGame(key);
      if (!gameCheck.allowed) return { blocked: true, resetAt: gameCheck.resetAt };

      const secret = Math.floor(Math.random() * (MAX_NUMBER - MIN_NUMBER + 1)) + MIN_NUMBER;
      startSession(key, secret);
      registerNewGame(key);
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
  });

  if (result?.blocked) {
    await interaction.reply({
      content: `⏳ Ya jugaste ${MAX_GAMES_PER_WINDOW} partidas nuevas de /guess hoy. Podés arrancar una nueva <t:${Math.floor(result.resetAt / 1000)}:R>.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
