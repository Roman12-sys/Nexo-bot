// Mascotas: una por usuario. Hambre/felicidad decaen con el tiempo (lazy, sin cron —
// mismo criterio que el interés del banco) pero cada una decae desde SU PROPIO último
// toque (last_fed para hambre, last_played para felicidad) en vez de un timestamp único
// compartido — eso fue justo el bug que encontramos en el banco (reusar un solo reloj
// para dos cosas distintas permite que uno quede desincronizado del otro).
import { supabase } from '../supabaseClient.js';

const TABLE = 'pets';

export const SPECIES = {
  perro: { emoji: '🐶', name: 'Perro' },
  gato: { emoji: '🐱', name: 'Gato' },
  dragon: { emoji: '🐉', name: 'Dragón' },
  conejo: { emoji: '🐰', name: 'Conejo' },
  zorro: { emoji: '🦊', name: 'Zorro' },
};

const HUNGER_DECAY_PER_HOUR = 2; // llega a 0 en ~50hs sin comer
const HAPPINESS_DECAY_PER_HOUR = 3; // llega a 0 en ~33hs sin jugar
const FEED_HUNGER_GAIN = 40;
const FEED_XP_GAIN = 15;
const PLAY_HAPPINESS_GAIN = 35;
const PLAY_XP_GAIN = 20;
export const PLAY_COOLDOWN_MS = 60 * 60 * 1000;
export const ADOPTION_COST = 500;

// Umbral para el bonus a /work y /crime — mascota bien cuidada (ni hambrienta ni triste)
// da un empujón. No hay "muerte" ni penalización más allá de perder el bonus: descuidarla
// nunca te dice adiós, solo deja de ayudarte.
export const BONUS_THRESHOLD = 50;

// "Crianza": en vez de múltiples mascotas por usuario (hubiera significado rehacer
// getPet/el bonus/todo el comando /pet, que asumen una sola), la cría es progresiva —
// tu MISMA mascota evoluciona de etapa con el nivel, y el bonus escala con la etapa. El
// nivel viene de FEED_XP_GAIN/PLAY_XP_GAIN/BATTLE_XP_GAIN de abajo — cuidarla y pelear
// con ella es lo que la hace crecer.
const STAGES = [
  { minLevel: 0, label: 'Cría', bonusMultiplier: 1.1 },
  { minLevel: 5, label: 'Adulto', bonusMultiplier: 1.15 },
  { minLevel: 15, label: 'Veterano', bonusMultiplier: 1.2 },
  { minLevel: 30, label: 'Legendario', bonusMultiplier: 1.3 },
];

export function getPetStage(level) {
  let current = STAGES[0];
  for (const stage of STAGES) {
    if (level >= stage.minLevel) current = stage;
  }
  return current;
}

const BATTLE_XP_GAIN = 25;
export const BATTLE_COOLDOWN_MS = 30 * 60 * 1000;
export const BATTLE_REWARD_MIN = 100;
export const BATTLE_REWARD_MAX = 200;

function rowToPet(row) {
  if (!row) return null;
  return {
    species: row.species,
    name: row.name,
    level: row.level,
    xp: row.xp,
    hunger: row.hunger,
    happiness: row.happiness,
    lastFed: row.last_fed,
    lastPlayed: row.last_played,
    lastBattle: row.last_battle || 0,
    wins: row.wins || 0,
    losses: row.losses || 0,
    createdAt: row.created_at,
  };
}

export function petXpRequiredForLevel(level) {
  return 20 * level + 40;
}

export function getPetLevelProgress(totalXp) {
  let level = 0;
  let remaining = totalXp;
  while (remaining >= petXpRequiredForLevel(level)) {
    remaining -= petXpRequiredForLevel(level);
    level += 1;
  }
  return { level, currentLevelXp: remaining, xpForNextLevel: petXpRequiredForLevel(level) };
}

// Aplica el decaimiento a los valores GUARDADOS, sin escribir nada — para mostrar en
// /pet ver o calcular el bonus sin necesitar una escritura solo por consultar.
export function computePetStats(pet) {
  const now = Date.now();
  const hoursSinceFed = Math.max(0, (now - pet.lastFed) / (60 * 60 * 1000));
  const hoursSincePlayed = Math.max(0, (now - pet.lastPlayed) / (60 * 60 * 1000));
  return {
    ...pet,
    hunger: Math.max(0, Math.round(pet.hunger - hoursSinceFed * HUNGER_DECAY_PER_HOUR)),
    happiness: Math.max(0, Math.round(pet.happiness - hoursSincePlayed * HAPPINESS_DECAY_PER_HOUR)),
  };
}

export function getPetBonusMultiplier(pet) {
  if (!pet) return 1;
  const current = computePetStats(pet);
  if (current.hunger < BONUS_THRESHOLD || current.happiness < BONUS_THRESHOLD) return 1;
  return getPetStage(pet.level).bonusMultiplier;
}

export async function getPet(guildId, userId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('species, name, level, xp, hunger, happiness, last_fed, last_played, last_battle, wins, losses, created_at')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return rowToPet(data);
}

// Devuelve false si el usuario ya tenía una mascota (primary key compuesta hace de guarda).
export async function createPet(guildId, userId, species, name) {
  const now = Date.now();
  const { error } = await supabase.from(TABLE).insert({
    guild_id: guildId,
    user_id: userId,
    species,
    name,
    level: 0,
    xp: 0,
    hunger: 100,
    happiness: 100,
    last_fed: now,
    last_played: now,
    last_battle: 0,
    wins: 0,
    losses: 0,
  });

  if (error) {
    if (error.code === '23505') return false;
    throw error;
  }
  return true;
}

export async function renamePet(guildId, userId, name) {
  const { error } = await supabase.from(TABLE).update({ name }).eq('guild_id', guildId).eq('user_id', userId);
  if (error) throw error;
}

export async function feedPet(guildId, userId) {
  const pet = await getPet(guildId, userId);
  if (!pet) return null;

  const current = computePetStats(pet);
  const now = Date.now();
  const newHunger = Math.min(100, current.hunger + FEED_HUNGER_GAIN);
  const newXp = pet.xp + FEED_XP_GAIN;
  const progress = getPetLevelProgress(newXp);

  const { error } = await supabase
    .from(TABLE)
    .update({ hunger: newHunger, xp: newXp, level: progress.level, last_fed: now })
    .eq('guild_id', guildId)
    .eq('user_id', userId);
  if (error) throw error;

  return { ...pet, hunger: newHunger, happiness: current.happiness, xp: newXp, level: progress.level, lastFed: now, leveledUp: progress.level > pet.level };
}

export async function playWithPet(guildId, userId) {
  const pet = await getPet(guildId, userId);
  if (!pet) return null;

  const current = computePetStats(pet);
  const now = Date.now();
  const newHappiness = Math.min(100, current.happiness + PLAY_HAPPINESS_GAIN);
  const newXp = pet.xp + PLAY_XP_GAIN;
  const progress = getPetLevelProgress(newXp);

  const { error } = await supabase
    .from(TABLE)
    .update({ happiness: newHappiness, xp: newXp, level: progress.level, last_played: now })
    .eq('guild_id', guildId)
    .eq('user_id', userId);
  if (error) throw error;

  return { ...pet, happiness: newHappiness, hunger: current.hunger, xp: newXp, level: progress.level, lastPlayed: now, leveledUp: progress.level > pet.level };
}

// "Poder" de pelea: nivel + qué tan bien cuidada está (una mascota descuidada pelea peor,
// mismo criterio que el bonus a /work) + un factor al azar para que el resultado nunca
// sea 100% determinado por el nivel — un nivel bajo bien cuidado le puede ganar a uno
// alto descuidado.
function petPower(pet) {
  const current = computePetStats(pet);
  const careScore = (current.hunger + current.happiness) / 2; // 0-100
  const base = pet.level * 10 + careScore;
  const variance = 0.7 + Math.random() * 0.6; // ±30%
  return base * variance;
}

// Resuelve un combate entre dos mascotas YA cargadas (no toca la base) — el caller
// (pet.js) decide qué hacer con el resultado (registrar wins/losses, dar XP/recompensa).
export function resolveBattle(petA, petB) {
  const powerA = petPower(petA);
  const powerB = petPower(petB);
  return powerA >= powerB ? 'A' : 'B';
}

export async function recordBattleResult(guildId, userId, { won, now }) {
  const pet = await getPet(guildId, userId);
  if (!pet) return null;

  const newXp = pet.xp + (won ? BATTLE_XP_GAIN : Math.floor(BATTLE_XP_GAIN / 2));
  const progress = getPetLevelProgress(newXp);
  const patch = {
    xp: newXp,
    level: progress.level,
    last_battle: now,
    wins: pet.wins + (won ? 1 : 0),
    losses: pet.losses + (won ? 0 : 1),
  };

  const { error } = await supabase.from(TABLE).update(patch).eq('guild_id', guildId).eq('user_id', userId);
  if (error) throw error;

  return { ...pet, xp: newXp, level: progress.level, lastBattle: now, wins: patch.wins, losses: patch.losses, leveledUp: progress.level > pet.level };
}
