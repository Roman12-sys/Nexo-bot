import { supabase } from '../supabaseClient.js';

const CACHE_TTL_MS = 30_000;
const cache = new Map(); // guild_id -> { value, expiresAt }

// QUÉ CAMBIÓ: se agregaron las 4 columnas que faltaban (confession_require_approval,
// confession_blocked_ids, xp_weekend_boost, xp_ignored_channel_ids).
// MOTIVO: auditoría 2026-08-29 (Diagnóstico Nexo, Parte 22) — defaultConfig() no
// coincidía con los defaults reales de schema.sql: antes del primer /setup de un guild
// (sin fila todavía en guild_config), leer cfg.xp_weekend_boost daba `undefined` en vez
// de `false`, y cfg.confession_blocked_ids/xp_ignored_channel_ids daban `undefined` en
// vez de `[]` — inconsistente con el resto del objeto, que sí tenía sus defaults.
// VERIFICACIÓN: en un guild SIN fila en guild_config todavía, /config ver no debe
// tirar error y debe mostrar "❌ Apagado" / "0" en esos 4 campos, no undefined.
function defaultConfig(guildId) {
  return {
    guild_id: guildId,
    admin_role_id: null,
    moderator_role_id: null,
    punish_role_id: null,
    auto_role_id: null,
    welcome_channel_id: null,
    log_channel_moderation_id: null,
    log_channel_activity_id: null,
    log_channel_economy_id: null,
    confession_channel_id: null,
    xp_announce_channel_id: null,
    lol_announce_channel_id: null,
    report_channel_id: null,
    selfassignable_roles: [],
    level_roles: {},
    level_roles_mode: 'cumulative',
    xp_ignored_channel_ids: [],
    xp_weekend_boost: false,
    confession_require_approval: false,
    confession_blocked_ids: [],
    features: {},
    setup_category_id: null,
    setup_completed_at: null,
  };
}

export async function getGuildConfig(guildId) {
  const cached = cache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const { data, error } = await supabase
    .from('guild_config')
    .select('*')
    .eq('guild_id', guildId)
    .maybeSingle();

  if (error) throw error;

  const value = data ?? defaultConfig(guildId);
  cache.set(guildId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export async function setGuildConfig(guildId, patch) {
  const { data, error } = await supabase
    .from('guild_config')
    .upsert(
      { guild_id: guildId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'guild_id' },
    )
    .select()
    .single();

  if (error) throw error;

  cache.set(guildId, { value: data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

export function invalidateGuildConfig(guildId) {
  cache.delete(guildId);
}

// QUÉ CAMBIÓ: función nueva. Usada por lolPatchEngine.js para saber a qué servidores
// (y a qué canal de cada uno) avisarle de un patch nuevo.
// MOTIVO: auditoría 2026-08-29 (Diagnóstico Nexo, Parte 15/22) — LoL pasó de un canal
// fijo hardcodeado a una columna opt-in de guild_config; el barrido necesita la lista
// completa, no una lectura de a un guild por vez (por eso no usa getGuildConfig+cache,
// que está pensado para el caso "necesito la config de UN server puntual").
// VERIFICACIÓN: con 0 servidores configurados devuelve [], no null ni error.
export async function getGuildsWithLolAnnounceChannel() {
  const { data, error } = await supabase
    .from('guild_config')
    .select('guild_id, lol_announce_channel_id')
    .not('lol_announce_channel_id', 'is', null);

  if (error) throw error;
  return (data || []).map((row) => ({ guildId: row.guild_id, channelId: row.lol_announce_channel_id }));
}
