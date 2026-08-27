-- Migración: fixes críticos de la auditoría 2026-08-27
-- Correr ENTERO en el SQL Editor del proyecto Supabase REAL (gmcqbvrqqpmcqjrbtauk,
-- NO el viejo de gNoX wglbcbwgrtadcnavtpxg). Verificar después contra la API, no
-- confiar solo en el "Success" del editor.

-- 1) Columnas faltantes que el código ya usa (sin esto, /sorteo con rol requerido y
--    /recordatorio recurrente fallan con "column does not exist").
alter table giveaways add column if not exists required_role_id text;
alter table reminders add column if not exists repeat_ms bigint;

-- 2) RPC atómica para los dos cooldowns de /rob (robber + víctima) en una sola
--    transacción — antes eran dos UPDATE independientes vía Promise.all() en JS,
--    con ventana real de "uno pega y el otro falla".
create or replace function set_rob_cooldowns(p_guild_id text, p_robber_id text, p_robber_ts bigint, p_victim_id text, p_victim_ts bigint)
returns void
language plpgsql
as $$
begin
  update economy set last_rob = p_robber_ts where guild_id = p_guild_id and user_id = p_robber_id;
  update economy set last_robbed = p_victim_ts where guild_id = p_guild_id and user_id = p_victim_id;
end;
$$;

-- 3) Índices faltantes en las 2 tablas donde guild_id NO forma parte de ninguna PK ni
--    constraint UNIQUE existente (el resto de las tablas ya tenían un índice implícito
--    por su PK/UNIQUE compuesta — se verificó una por una antes de agregar nada acá).
create index if not exists voice_channel_stats_guild_idx on voice_channel_stats (guild_id);
create index if not exists reminders_guild_user_idx on reminders (guild_id, user_id);
