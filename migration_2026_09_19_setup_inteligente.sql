-- NEXO Setup Inteligente — bienvenida personalizable + contador de miembros.
-- PREPARADA, NO CORRIDA TODAVÍA (ver CLAUDE.md / informe de la sesión que la generó).
--
-- 100% aditiva, todas nullable sin default — un guild que nunca toca el editor de
-- bienvenida ni activa el contador sigue funcionando exactamente igual que hoy (mismo
-- criterio que las columnas economy_* de la migración del 2026-09-15). Correr DESPUÉS
-- de que el código que las usa (src/utils/welcomeEmbed.js, src/utils/memberCounterEngine.js,
-- el panel de /setup) esté desplegado en Railway, no antes — ver el gotcha de
-- "código antes que el DROP/ALTER" en CLAUDE.md. Como es solo `add column`, no hay
-- ningún riesgo real de romper producción si igual se corre antes (a diferencia de un
-- DROP): el bot ya desplegado simplemente no las conoce hasta que se actualice.

alter table guild_config add column if not exists welcome_title text;
alter table guild_config add column if not exists welcome_description text;
alter table guild_config add column if not exists welcome_color text;
alter table guild_config add column if not exists welcome_footer text;
alter table guild_config add column if not exists member_counter_channel_id text;
alter table guild_config add column if not exists member_counter_last_count integer;
