import { supabase } from '../supabaseClient.js';

const CACHE_TTL_MS = 30_000;
const cache = new Map(); // guild_id -> { value, expiresAt }

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
    level_roles: {},
    level_roles_mode: 'cumulative',
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
