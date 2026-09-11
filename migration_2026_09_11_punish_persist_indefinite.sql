-- MOD-2 (auditoría completa NEXO, 2026-09-11): /punish se evadía por completo saliendo
-- y reentrando al servidor. Discord quita todos los roles al salir (comportamiento
-- nativo, no de Nexo); guildMemberAdd.js nunca reaplicaba active_punishments porque
-- las restricciones INDEFINIDAS (sin /punish duracion:...) nunca tenían fila ahí —
-- solo se creaba una fila cuando el staff elegía una duración explícita.
--
-- Este ALTER es puramente aditivo/permisivo (relaja un NOT NULL a nullable) — seguro
-- de correr ANTES de que el código nuevo esté desplegado, mismo criterio que
-- migration_2026_09_10_cycle2.sql: el código viejo sigue insertando expires_at con un
-- valor real (nunca NULL) hasta que se despliegue, así que nada se rompe en el medio.
--
-- Orden: correr esto en Supabase, y recién después desplegar el commit que empieza a
-- insertar filas con expires_at = NULL (restricciones indefinidas).

alter table active_punishments alter column expires_at drop not null;

-- Verificación sugerida después de correrlo:
-- select column_name, is_nullable from information_schema.columns
--   where table_name = 'active_punishments' and column_name = 'expires_at';
-- (tiene que devolver is_nullable = 'YES')
