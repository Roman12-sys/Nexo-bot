// Guard global de la suite: ningún test puede hablar con la Supabase real.
//
// src/config.js hace `import 'dotenv/config'`, y el .env local tiene la service_role key
// de PRODUCCIÓN (no existe una base de desarrollo separada). Un test que importa un
// comando sin mockear su store terminaba escribiendo en producción — pasó de verdad:
// 990 filas de guild-1/mod-1 en moderation_actions (auditoría 2026-09-23).
//
// dotenv nunca pisa una variable que ya está definida, así que fijarlas acá (setupFiles
// corre antes de que cada archivo de test importe nada) gana siempre. La URL apunta a un
// puerto local cerrado: una llamada sin mock falla al instante con ECONNREFUSED en vez de
// llegar a producción, y la key real nunca entra al proceso de test.
process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key-no-real-supabase';
