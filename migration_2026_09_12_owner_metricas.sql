-- Observabilidad de negocio (plan de ejecución post-auditoría, Fase 5, 2026-09-12) —
-- la auditoría completa NEXO encontró que toda la analítica existente (command_usage,
-- guild_daily_stats) está estrictamente filtrada por guild: no hay ningún lugar donde
-- el OPERADOR del bot (no un admin de un server puntual) pueda ver cuántos servidores
-- tiene el bot en total, ni si está creciendo o perdiendo servidores con el tiempo.
--
-- bot_guild_events es deliberadamente chico: un evento por join/leave, nada más. NO es
-- una tabla guild-scoped en el sentido de src/events/guildDelete.js — al contrario, el
-- valor de esta tabla ES justamente conservar el historial de churn incluso (sobre todo)
-- cuando un guild se va. Por eso NO se agrega a GUILD_SCOPED_TABLES.
--
-- Migración puramente aditiva (tabla nueva, ninguna existente tocada) — segura de
-- correr en cualquier momento, incluso antes de desplegar el código de
-- botGuildEventsStore.js/guildCreate.js/guildDelete.js/ownerMetricas.js que la usa (esos
-- INSERT nuevos simplemente no existen hasta el deploy; sin esta migración corrida
-- ANTES, el primer join/leave después del deploy fallaría con "relation
-- bot_guild_events does not exist" — mismo criterio de orden que cualquier tabla nueva
-- de la que el código pasa a depender).
create table if not exists bot_guild_events (
  id bigint generated always as identity primary key,
  guild_id text not null,
  event_type text not null check (event_type in ('join', 'leave')),
  created_at timestamptz not null default now()
);
create index if not exists bot_guild_events_created_at_idx on bot_guild_events (created_at);

-- Verificación sugerida después de correrla:
-- insert into bot_guild_events (guild_id, event_type) values ('test-guild', 'join');
-- select * from bot_guild_events where guild_id = 'test-guild';
-- delete from bot_guild_events where guild_id = 'test-guild';
