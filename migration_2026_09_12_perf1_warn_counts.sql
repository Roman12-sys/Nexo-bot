-- PERF-1 (plan de ejecución post-auditoría a Auditoría NEXO II, 2026-09-12): el botón
-- "Advertencias" del panel /sanciones (sanciones_warns, sanciones.js) llamaba
-- getGuildWarns(), que trae CADA fila de la tabla warnings del server ENTERO (motivo,
-- moderador, fecha de cada advertencia jamás dada) solo para descartar todo menos un
-- conteo por usuario — en un server con años de moderación activa, esa tabla solo
-- crece, nunca se achica. Esta función agrupa y cuenta en Postgres (mismo patrón que
-- top_guild_achievers, migration_2026_09_01_fase2c.sql) — el conteo por usuario nunca
-- transfiere más que 25 filas chicas, sin importar cuántas advertencias tenga el
-- servidor en su historial completo.
--
-- Esta migración es puramente ADITIVA (una función nueva, ninguna tabla/columna
-- tocada) — segura de correr en cualquier momento, incluso antes de desplegar el código
-- de warnsStore.js/sanciones.js que la llama (ese código sigue sin usarse hasta el
-- deploy; después del deploy, sin esta función, `/sanciones` -> "Advertencias" tira
-- error de Postgres "function get_guild_warn_counts does not exist" hasta que se corra).
--
-- total_users va como columna repetida en cada fila (via count(*) over(), calculado
-- sobre los grupos ANTES del limit) en vez de una segunda query aparte — un solo
-- round-trip para "las primeras N" + "cuántas hay en total", mismo criterio que ya usa
-- xpStore.getGuildXpPage/economyStore.getGuildEconomyPage (PERF-1, mismo plan) para
-- ranking/leaderboard.
create or replace function get_guild_warn_counts(p_guild_id text, p_limit integer default 25)
returns table(user_id text, warn_count bigint, total_users bigint)
language sql
stable
as $$
  select
    user_id,
    count(*) as warn_count,
    count(*) over () as total_users
  from warnings
  where guild_id = p_guild_id
  group by user_id
  order by min(created_at) asc
  limit p_limit;
$$;

-- Verificación sugerida después de correrla:
-- select * from get_guild_warn_counts('un_guild_id_real', 25);
-- (con un guild sin advertencias, debe devolver 0 filas sin error)
