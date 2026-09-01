-- Migración: Fase 2A.1 (retry automático de anuncios de sorteos pendientes, 2026-08-31)
-- Correr ENTERO en el SQL Editor del proyecto Supabase REAL (gmcqbvrqqpmcqjrbtauk,
-- NO el viejo de gNoX wglbcbwgrtadcnavtpxg). Verificar después contra la API/tabla real,
-- no confiar solo en el "Success" del editor.
--
-- Requiere que migration_2026_08_31_fase2a.sql ya haya corrido antes (esta migración
-- asume que la columna giveaways.winners_announced_at ya existe). Si todavía no corrió
-- esa, correrla primero.
--
-- Único cambio de base de datos de esta fase: el índice parcial que usa
-- getGiveawaysPendingAnnouncement() (giveawaysStore.js), consultada ahora tanto al
-- arrancar como cada 5 minutos por el loop nuevo (startGiveawayReconcileLoop,
-- giveawayEngine.js) — sin este índice, ese barrido periódico escanearía el historial
-- completo de sorteos ya anunciados en cada tick.
create index if not exists giveaways_pending_announcement_idx on giveaways (guild_id, message_id)
  where ended = true and cancelled = false and winners_announced_at is null;
