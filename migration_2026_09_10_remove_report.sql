-- Eliminación completa del sistema /report (decisión de producto, 2026-09-10) — ver
-- CLAUDE.md. La columna SÍ existe en producción (verificado por API directa contra
-- Supabase: GET guild_config?select=report_channel_id devuelve 200, no 42703 — el
-- comentario "MIGRACIÓN MANUAL PENDIENTE" que quedó en schema.sql estaba desactualizado,
-- la migración de Fase 4C-1 se había corrido en algún momento sin que ese comentario se
-- borrara). Verificado también que hay UNA fila con valor no nulo (guild_id
-- 1182874699169017987, report_channel_id 1375982023432208497) — se pierde ese dato al
-- correr esto, es el único efecto real de esta migración: nadie tiene report_channel_id
-- en ningún otro lugar (ni tabla ni columna) del código ni del schema tras esta fase.
--
-- Igual que cualquier DROP: correr DESPUÉS de que el código de esta fase esté
-- commiteado/pusheado/desplegado, nunca antes (ver el gotcha de CLAUDE.md sobre el orden
-- correcto — Pets se rompió en producción una vez por invertir este orden). Verificar por
-- API después de correrla, no confiar solo en "Success".

alter table guild_config drop column if exists report_channel_id;
