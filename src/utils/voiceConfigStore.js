// Configuración por guild del sistema de canales de voz temporales (Join to Create).
// Tabla voice_channel_config, una fila por servidor — mismo patrón que el resto de
// los *Store.js, y el precedente directo de guild_config: la primera store de gNoX
// que ya vivía keyed por guild_id en vez de asumir un único servidor.
import { supabase } from '../supabaseClient.js';

const TABLE = 'voice_channel_config';

function rowToConfig(row) {
  if (!row) return null;
  return {
    guildId: row.guild_id,
    createChannelId: row.create_channel_id,
    categoryId: row.category_id,
    enabled: row.enabled,
  };
}

// null si el servidor nunca configuró el sistema (equivalente a "desactivado + sin datos")
export async function getGuildVoiceConfig(guildId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('guild_id, create_channel_id, category_id, enabled')
    .eq('guild_id', guildId)
    .maybeSingle();

  if (error) throw error;
  return rowToConfig(data);
}

// Crea o reemplaza la configuración de un guild (usado por /voice setup). Upsert por
// guild_id: correrlo de nuevo con otro canal/categoría simplemente actualiza la fila.
export async function upsertGuildVoiceConfig(guildId, { createChannelId, categoryId, enabled }) {
  const { error } = await supabase.from(TABLE).upsert(
    {
      guild_id: guildId,
      create_channel_id: createChannelId,
      category_id: categoryId,
      enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'guild_id' },
  );

  if (error) throw error;
}

// /voice disable: apaga el sistema sin borrar el canal/categoría guardados, para que
// /voice setup posterior (o simplemente reactivarlo) no pierda esos valores.
export async function disableGuildVoiceConfig(guildId) {
  const { error } = await supabase
    .from(TABLE)
    .update({ enabled: false, updated_at: new Date().toISOString() })
    .eq('guild_id', guildId);

  if (error) throw error;
}
