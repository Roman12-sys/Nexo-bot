-- Migración: Ciclo 2, Bloque 11 (digest semanal, 2026-09-10)
-- Correr ENTERO en el SQL Editor del proyecto Supabase REAL (gmcqbvrqqpmcqjrbtauk,
-- NO el viejo de gNoX wglbcbwgrtadcnavtpxg). Verificar después contra la API/tabla real,
-- no confiar solo en el "Success" del editor.
--
-- Correr DESPUÉS de que el código de este ciclo esté desplegado (ver CLAUDE.md, gotcha
-- "Correr un DROP/ALTER antes de que el código nuevo esté desplegado") — antes de eso,
-- src/utils/weeklyDigestEngine.js y /config digest-semanal ni siquiera pueden ejecutarse
-- (el código vive solo en el working tree, no en Railway).
--
-- Único cambio: las 2 columnas opt-in que usa el digest semanal (ver
-- src/utils/weeklyDigestEngine.js, src/commands/admin/config.js "digest-semanal").
-- weekly_digest_last_sent_at es epoch ms (mismo criterio que las columnas de cooldown,
-- ver CLAUDE.md) — se siembra al activar el digest, nunca queda null mientras está
-- activo.
alter table guild_config add column if not exists weekly_digest_enabled boolean not null default false;
alter table guild_config add column if not exists weekly_digest_last_sent_at bigint;
