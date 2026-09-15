-- Reaction-roles como panel de botones (plan de ejecución 2026-09-15) — P1 de Fase 4B,
-- evaluado y diferido a propósito hasta ahora. A diferencia de selfassignable_roles (una
-- sola lista plana en guild_config), acá cada guild puede tener VARIOS paneles
-- independientes en canales distintos, con roles distintos — de ahí la tabla nueva en
-- vez de una columna más.
--
-- Migración puramente aditiva (tabla nueva, ninguna existente tocada) — segura de correr
-- en cualquier momento, incluso antes de desplegar el código de
-- src/utils/reactionRolePanels.js/src/commands/admin/rolreacciones.js que la usa (mismo
-- criterio que migration_2026_09_12_owner_metricas.sql).
create table if not exists reaction_role_panels (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  channel_id text not null,
  message_id text not null unique,
  roles jsonb not null, -- [{ "roleId": "...", "label": "..." }, ...] — hasta 5
  created_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists reaction_role_panels_guild_id_idx on reaction_role_panels (guild_id);

-- Verificación sugerida después de correrla:
-- select * from reaction_role_panels limit 1;
