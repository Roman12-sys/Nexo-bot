import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

export const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  auth: { persistSession: false },
});

// Chequeo de conectividad real (no de cache) — a diferencia de getGuildConfig, que
// puede devolver un valor cacheado de hasta 30s sin tocar la red, esto siempre hace un
// round-trip real a Postgres. Lo usa /estado. head:true evita traer filas de verdad,
// solo el conteo — la consulta más barata posible que igual prueba la conexión.
export async function pingSupabase() {
  const start = Date.now();
  const { error } = await supabase.from('guild_config').select('guild_id', { head: true, count: 'exact' });
  return { ok: !error, ms: Date.now() - start };
}
