-- Tuning de economía por servidor — núcleo (plan de ejecución 2026-09-15) — P1 de
-- Fase 4B, evaluado y diferido a propósito hasta ahora. Alcance acotado a lo que un
-- admin real ajusta para balancear su economía: rangos de pago de /daily /work /crime,
-- probabilidad de éxito de /crime y /rob, y % de robo/multa de /rob. Casino, interés de
-- banco y XP quedan con su valor global de siempre (ver src/utils/economyTuning.js).
--
-- Todas nullable, sin default — null significa "usar la constante global de siempre"
-- (ver DAILY_DEFAULT/WORK_DEFAULT/CRIME_DEFAULT/ROB_DEFAULT en economyTuning.js). Los
-- porcentajes se guardan como enteros 1-100 (más cómodo para un admin que un float).
--
-- Migración puramente aditiva (columnas nuevas, ninguna fila existente tocada) — segura
-- de correr en cualquier momento, incluso antes de desplegar el código que las usa
-- (mismo criterio que migration_2026_09_12_owner_metricas.sql).
alter table guild_config add column if not exists economy_daily_min integer;
alter table guild_config add column if not exists economy_daily_max integer;
alter table guild_config add column if not exists economy_work_min integer;
alter table guild_config add column if not exists economy_work_max integer;
alter table guild_config add column if not exists economy_crime_min integer;
alter table guild_config add column if not exists economy_crime_max integer;
alter table guild_config add column if not exists economy_crime_success_percent smallint;
alter table guild_config add column if not exists economy_rob_success_percent smallint;
alter table guild_config add column if not exists economy_rob_steal_percent_min smallint;
alter table guild_config add column if not exists economy_rob_steal_percent_max smallint;
alter table guild_config add column if not exists economy_rob_fine_percent_min smallint;
alter table guild_config add column if not exists economy_rob_fine_percent_max smallint;
