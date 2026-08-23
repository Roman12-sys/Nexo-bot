// Catálogo de tienda por servidor. Si un guild nunca agregó un ítem propio (tabla
// vacía para ese guild_id), se usan los 4 ítems de ejemplo de shopItems.js — así la
// tienda funciona sin configuración. En cuanto el servidor agrega su primer ítem,
// ESE es su catálogo completo (los de ejemplo dejan de mostrarse): no tiene sentido
// mezclar "lo que vino con el bot" con lo que el servidor arma a propósito.
import { supabase } from '../supabaseClient.js';
import DEFAULT_ITEMS from './shopItems.js';

const TABLE = 'shop_items';

function rowToItem(row) {
  return {
    id: row.item_id,
    name: row.name,
    description: row.description,
    category: row.category,
    price: row.price,
    roleId: row.role_id || null,
    fulfillment: row.fulfillment || undefined,
  };
}

// Convierte un nombre en un id interno estable (lo que se guarda en
// economy.inventory). No se expone al usuario, solo identifica el ítem.
export function slugifyItemId(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // saca acentos (NFD separa la letra del diacrítico)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
}

// Para poder avisar "a partir de ahora usás tu propio catálogo" solo la primera vez
// que un servidor agrega un ítem (antes de que exista, así que no sirve mirar
// getGuildShopItems, que ya haría fallback a los de ejemplo).
export async function hasCustomShopItems(guildId) {
  const { count, error } = await supabase.from(TABLE).select('id', { count: 'exact', head: true }).eq('guild_id', guildId);
  if (error) throw error;
  return (count || 0) > 0;
}

export async function getGuildShopItems(guildId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('item_id, name, description, category, price, role_id, fulfillment')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  if (data && data.length > 0) return data.map(rowToItem);
  return DEFAULT_ITEMS;
}

export async function getShopItem(guildId, itemId) {
  const items = await getGuildShopItems(guildId);
  return items.find((i) => i.id === itemId) || null;
}

// Devuelve el item_id generado (por si el nombre pedía slugificarse) o null si ya
// existe un ítem con ese id en el servidor.
export async function addShopItem(guildId, item) {
  const itemId = slugifyItemId(item.name);
  if (!itemId) throw new Error('El nombre del ítem no generó un identificador válido.');

  const { error } = await supabase.from(TABLE).insert({
    guild_id: guildId,
    item_id: itemId,
    name: item.name,
    description: item.description || '',
    category: item.category || 'General',
    price: item.price,
    role_id: item.roleId || null,
    fulfillment: item.fulfillment || null,
  });

  if (error) {
    if (error.code === '23505') return null; // unique_violation: ya existe ese item_id en este guild
    throw error;
  }
  return itemId;
}

export async function removeShopItem(guildId, itemId) {
  const { error, count } = await supabase
    .from(TABLE)
    .delete({ count: 'exact' })
    .eq('guild_id', guildId)
    .eq('item_id', itemId);

  if (error) throw error;
  return count > 0;
}
