// Plantillas de /anuncio guardadas por servidor — antes cada anuncio se armaba de cero
// con el builder interactivo, aunque el formato se repitiera seguido (ej. un aviso
// semanal con el mismo layout). Guarda el draft completo del panel MENOS la mención
// (rol/usuario/everyone son específicos de un envío puntual, no parte del formato).
import { supabase } from '../supabaseClient.js';

const TABLE = 'announcement_templates';

export async function getGuildAnnouncementTemplates(guildId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('name, data, created_at')
    .eq('guild_id', guildId)
    .order('name', { ascending: true });

  if (error) throw error;
  return (data || []).map((row) => ({ name: row.name, data: row.data, createdAt: row.created_at }));
}

export async function getAnnouncementTemplate(guildId, name) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('data')
    .eq('guild_id', guildId)
    .eq('name', name)
    .maybeSingle();

  if (error) throw error;
  return data?.data || null;
}

// Devuelve false si ya existe una plantilla con ese nombre en el servidor (unique_violation).
export async function saveAnnouncementTemplate(guildId, name, data, createdBy) {
  const { error } = await supabase.from(TABLE).insert({ guild_id: guildId, name, data, created_by: createdBy });

  if (error) {
    if (error.code === '23505') return false;
    throw error;
  }
  return true;
}
