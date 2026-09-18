-- CHECK constraints para las 12 columnas de tuning de economía por servidor (Auditoría
-- NEXO V, 2026-09-18) — defensa en profundidad, no el cierre de un bypass real. Hoy el
-- único escritor (/config economia, handleEconomiaSubcommand en src/commands/admin/
-- config.js) ya valida min<=max en la app antes de guardar, y Discord acota los
-- porcentajes a 1-100 con setMinValue/setMaxValue en la opción del slash command — nada
-- de esto es alcanzable hoy desde el bot. Solo protege contra una escritura futura que
-- se salte ese único call-site (SQL a mano, un panel de escritura que todavía no existe).
--
-- Todas las columnas son nullable (null = "usar el default global de economyTuning.js")
-- — cada CHECK deja pasar null explícitamente para no romper ninguna fila existente ni
-- bloquear "restablecer" (que escribe null a propósito).
--
-- Migración puramente aditiva — segura de correr en cualquier momento, el código
-- desplegado ya solo escribe valores que cumplen estas condiciones desde que existe la
-- feature (2026-09-15).
alter table guild_config add constraint economy_daily_range_check
  check (economy_daily_min is null or economy_daily_max is null or economy_daily_min <= economy_daily_max);
alter table guild_config add constraint economy_work_range_check
  check (economy_work_min is null or economy_work_max is null or economy_work_min <= economy_work_max);
alter table guild_config add constraint economy_crime_range_check
  check (economy_crime_min is null or economy_crime_max is null or economy_crime_min <= economy_crime_max);
alter table guild_config add constraint economy_crime_success_percent_check
  check (economy_crime_success_percent is null or economy_crime_success_percent between 1 and 100);
alter table guild_config add constraint economy_rob_success_percent_check
  check (economy_rob_success_percent is null or economy_rob_success_percent between 1 and 100);
alter table guild_config add constraint economy_rob_steal_range_check
  check (economy_rob_steal_percent_min is null or economy_rob_steal_percent_max is null or economy_rob_steal_percent_min <= economy_rob_steal_percent_max);
alter table guild_config add constraint economy_rob_steal_percent_min_check
  check (economy_rob_steal_percent_min is null or economy_rob_steal_percent_min between 1 and 100);
alter table guild_config add constraint economy_rob_steal_percent_max_check
  check (economy_rob_steal_percent_max is null or economy_rob_steal_percent_max between 1 and 100);
alter table guild_config add constraint economy_rob_fine_range_check
  check (economy_rob_fine_percent_min is null or economy_rob_fine_percent_max is null or economy_rob_fine_percent_min <= economy_rob_fine_percent_max);
alter table guild_config add constraint economy_rob_fine_percent_min_check
  check (economy_rob_fine_percent_min is null or economy_rob_fine_percent_min between 1 and 100);
alter table guild_config add constraint economy_rob_fine_percent_max_check
  check (economy_rob_fine_percent_max is null or economy_rob_fine_percent_max between 1 and 100);

-- Verificación sugerida después de correrla:
-- select conname from pg_constraint where conrelid = 'guild_config'::regclass and conname like 'economy_%';
