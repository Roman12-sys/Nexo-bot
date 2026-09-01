-- Migración: Fase 2C (performance/escalabilidad/operación, 2026-09-01)
-- Correr ENTERO en el SQL Editor del proyecto Supabase REAL (gmcqbvrqqpmcqjrbtauk,
-- NO el viejo de gNoX wglbcbwgrtadcnavtpxg). Verificar después contra la API/tabla real,
-- no confiar solo en el "Success" del editor.
--
-- Única razón de esta migración: dashboard/queries.js (sección 3 de la auditoría)
-- traía TODAS las filas de `economy`/`achievements_unlocked` de un guild a Node solo
-- para sumarlas/agruparlas ahí — costo que crece sin límite con la cantidad histórica de
-- usuarios/logros del server. Estas dos RPC hacen ese cálculo en Postgres (sum / group +
-- count + order + limit), transfiriendo como mucho un puñado de filas en vez del
-- historial completo. Ninguna de las dos escribe nada — son solo lectura agregada.

create or replace function sum_guild_balances(p_guild_id text)
returns bigint
language sql
stable
as $$
  select coalesce(sum(balance), 0)::bigint from economy where guild_id = p_guild_id;
$$;

create or replace function top_guild_achievers(p_guild_id text, p_limit integer default 5)
returns table(user_id text, unlock_count bigint)
language sql
stable
as $$
  select user_id, count(*) as unlock_count
  from achievements_unlocked
  where guild_id = p_guild_id
  group by user_id
  order by unlock_count desc, user_id
  limit p_limit;
$$;
