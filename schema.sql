-- Nexo Bot — schema inicial de Supabase
-- Basado en el esquema de gNoX (guild_id ya es parte de la PK en todas las tablas de stores),
-- generalizando el patrón de voice_channel_config a una tabla guild_config única.
-- Pegar completo en el SQL Editor del proyecto Supabase nuevo.
--
-- =========================================================
-- MIGRACIÓN MANUAL PENDIENTE (auditoría 2026-08-29, Fase 0 Tanda 2) — correr a mano
-- contra la base de PRODUCCIÓN real (gmcqbvrqqpmcqjrbtauk, no el proyecto viejo de
-- gNoX), y verificar por API después, no confiar solo en el "Success" del SQL Editor:
--
--   create table if not exists active_punishments (
--     guild_id text not null,
--     user_id text not null,
--     role_id text not null,
--     expires_at bigint not null,
--     created_at bigint not null,
--     primary key (guild_id, user_id)
--   );
--   create index if not exists active_punishments_expires_idx on active_punishments (expires_at);
--
--   drop function if exists increment_reputation(text, text, bigint);
--   drop table if exists reputation;
--
--   alter table guild_config add column if not exists lol_announce_channel_id text;
--
--   create table if not exists user_missions (
--     guild_id text not null, user_id text not null, mission_id text not null,
--     period text not null, period_start bigint not null,
--     progress integer not null default 0, target integer not null,
--     reward_coins integer not null default 0, reward_xp integer not null default 0,
--     completed_at bigint,
--     primary key (guild_id, user_id, mission_id, period_start)
--   );
--   create index if not exists user_missions_guild_user_idx on user_missions (guild_id, user_id);
--   -- + la función increment_mission_progress definida más abajo, sección RPCs.
--
-- La tabla/RPC de reputación ya no están definidas más abajo (Diagnóstico Nexo, Parte 11
-- — cero consumidores reales), active_punishments sí lo está (Parte 22, expiración
-- automática de /punish), lol_announce_channel_id es una columna nueva en guild_config
-- (Parte 15/22, Fase 2 — LoL pasa de canal fijo a opt-in por servidor), y user_missions
-- es la tabla nueva de Fase 3 (misiones diarias/semanales) — este bloque es solo para
-- que una base YA EXISTENTE alcance al schema.sql nuevo sin recrear todo desde cero.
-- =========================================================
--
-- MIGRACIÓN MANUAL PENDIENTE (Fase A, segunda auditoría, 2026-08-30) — money_destroyed,
-- nueva columna de guild_daily_stats (ver sección de esa tabla más abajo) + su RPC
-- actualizada:
--
--   alter table guild_daily_stats add column if not exists money_destroyed bigint not null default 0;
--
--   -- + reemplazar increment_guild_daily_stat completa por la versión nueva (con
--   -- p_money_destroyed) definida más abajo, sección RPCs — "create or replace" la
--   -- pisa sin dropearla, no hace falta borrar la vieja a mano.
-- =========================================================
--
-- MIGRACIÓN MANUAL PENDIENTE (Fase 1, auditoría de seguridad/economía, 2026-08-30) —
-- economy_transactions.delivered: el código (getGuildPurchasesByReason/
-- markPurchaseDelivered en economyStore.js, /economia-staff pendientes) ya usaba esta
-- columna, pero nunca se declaró acá — drift real entre schema.sql y lo que corre en
-- producción, no confirmado si la base real ya la tiene o no (ver migration_2026_08_30_
-- fase1.sql, que además incluye el guard atómico de increment_inventory_item de la misma
-- fase):
--
--   alter table economy_transactions add column if not exists delivered boolean not null default false;
-- =========================================================

-- =========================================================
-- guild_config: configuración por servidor (reemplaza .env)
-- =========================================================
create table if not exists guild_config (
  guild_id text primary key,

  -- roles
  admin_role_id text,
  moderator_role_id text,
  punish_role_id text,
  auto_role_id text,

  -- canales
  welcome_channel_id text,
  log_channel_moderation_id text,
  log_channel_activity_id text,
  log_channel_economy_id text,
  confession_channel_id text,
  xp_announce_channel_id text,
  lol_announce_channel_id text, -- opt-in: patch notes de LoL para ESTE servidor (ver lolPatchEngine.js)

  -- niveles
  level_roles jsonb not null default '{}',
  level_roles_mode text not null default 'cumulative' check (level_roles_mode in ('cumulative', 'replace')), -- únicos 2 valores que ofrece /config (addChoices)
  xp_ignored_channel_ids jsonb not null default '[]', -- canales que no dan XP por mensaje
  xp_weekend_boost boolean not null default false, -- sáb/dom: doble XP por mensaje y voz

  -- confesiones
  confession_require_approval boolean not null default false,
  confession_blocked_ids jsonb not null default '[]',

  -- features activadas por /setup (economía, xp, moderación, sorteos, trivia, voz, confesiones)
  features jsonb not null default '{}',

  setup_category_id text,
  setup_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================
-- Salas de voz temporales (Join to Create)
-- =========================================================
create table if not exists voice_channel_config (
  guild_id text primary key,
  create_channel_id text,
  category_id text,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists temporary_voice_channels (
  channel_id text primary key,
  guild_id text not null,
  owner_id text not null,
  category_id text,
  type text not null default 'public' check (type in ('public', 'private', 'invite_only')), -- únicos 3 valores que escribe tempVoiceEngine.js
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  unique (guild_id, owner_id)
);

create table if not exists voice_channel_stats (
  id bigint generated always as identity primary key,
  guild_id text not null,
  channel_id text not null,
  owner_id text not null,
  type text not null,
  created_at timestamptz not null default now(),
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  unique_users_count integer not null default 0 check (unique_users_count >= 0),
  max_concurrent_users integer not null default 0 check (max_concurrent_users >= 0)
);
-- A diferencia de temporary_voice_channels (donde unique(guild_id, owner_id) ya sirve
-- de índice para filtrar por guild_id), esta tabla no tenía NINGÚN índice por guild_id
-- — /voice estadísticas y el dashboard la consultan filtrando solo por guild_id.
create index if not exists voice_channel_stats_guild_idx on voice_channel_stats (guild_id);

-- =========================================================
-- Economía
-- =========================================================
create table if not exists economy (
  guild_id text not null,
  user_id text not null,
  balance bigint not null default 0 check (balance >= 0), -- "wallet": arriesgable por /rob. Piso >=0 ya lo garantizan las RPCs (greatest(0,...) / insufficient_funds) — el CHECK es la red de seguridad a nivel de tabla, contra cualquier escritura directa que las bypasee.
  last_daily bigint not null default 0, -- epoch ms, no timestamptz: el bot hace Date.now() - last_daily
  last_work bigint not null default 0,  -- idem
  daily_streak integer not null default 0 check (daily_streak >= 0), -- días consecutivos reclamando /daily
  bank bigint not null default 0 check (bank >= 0), -- protegido de /rob, rinde interés (ver collectBankInterest)
  last_interest_ts bigint not null default 0, -- se resetea en cada depósito/retiro, ver deposit_to_bank/withdraw_from_bank
  last_rob bigint not null default 0, -- cooldown de quien roba
  last_robbed bigint not null default 0, -- protección de quien fue robado
  last_crime bigint not null default 0,
  last_weekly bigint not null default 0,
  rob_shield_until bigint not null default 0 check (rob_shield_until >= 0), -- item de tienda type:'rob_shield'
  inventory jsonb not null default '{}',
  primary key (guild_id, user_id)
);

create table if not exists economy_transactions (
  id bigint generated always as identity primary key,
  guild_id text not null,
  user_id text not null,
  -- QUÉ CAMBIÓ (Fase 2A, 2026-08-31): comentario corregido — le faltaban 'mystery_box',
  -- 'mission' y 'admin_set_level', ya usados en código (buy.js, missionsStore.js,
  -- xpStaff.js) desde antes de esta fase. Verificado a mano contra CADA call-site real
  -- de addBalance/recordTransaction/setBalance en el repo (auditoría anterior a esta ya
  -- había detectado que el comentario estaba desactualizado, sin corregirlo).
  -- Sin CHECK a propósito: esta lista crece con cada feature nueva de economía y un
  -- CHECK desincronizado (como este comentario, que ya estuvo desactualizado una vez)
  -- rompería inserts legítimos en producción de forma silenciosa hasta notarlo.
  type text not null, -- 'daily' | 'work' | 'weekly' | 'crime_win' | 'crime_fine' | 'trivia' | 'guess' | 'purchase' | 'sell' | 'transfer_in' | 'transfer_out' | 'admin_add' | 'admin_remove' | 'admin_set' | 'admin_set_level' | 'gamble_bet' | 'gamble_win' | 'bank_deposit' | 'bank_withdraw' | 'bank_interest' | 'rob_win' | 'rob_loss' | 'rob_fine' | 'mystery_box' | 'mission'
  amount bigint not null,
  balance_after bigint not null,
  actor_id text,
  reason text,
  delivered boolean not null default false, -- solo aplica a type='purchase' de entrega MANUAL (ver getGuildPurchasesByReason/markPurchaseDelivered en economyStore.js, /economia-staff pendientes)
  created_at timestamptz not null default now()
);
create index if not exists economy_transactions_guild_user_idx on economy_transactions (guild_id, user_id);

-- Catálogo de tienda por servidor (/shop-admin). Si un guild no tiene ninguna fila
-- acá, /shop, /buy e /inventory usan los 4 ítems de ejemplo genéricos de
-- src/utils/shopItems.js — apenas el servidor agrega su primer ítem propio, ese
-- catálogo por defecto deja de mostrarse (ver src/utils/shopStore.js).
create table if not exists shop_items (
  id bigint generated always as identity primary key,
  guild_id text not null,
  item_id text not null, -- slug estable, es lo que queda guardado en economy.inventory
  name text not null,
  description text not null default '',
  category text not null default 'General',
  price bigint not null check (price > 0), -- /shop-admin agregar/editar ya validan setMinValue(1) en Discord; esto cierra la misma regla si alguna vez se escribe directo a la tabla
  role_id text,
  fulfillment text, -- null (automático, va al inventario) | 'manual' (staff lo entrega a mano)
  type text, -- null (ítem normal) | 'xp_boost' | 'mystery_box'
  created_at timestamptz not null default now(),
  unique (guild_id, item_id)
);

-- =========================================================
-- XP / niveles
-- =========================================================
create table if not exists xp (
  guild_id text not null,
  user_id text not null,
  xp bigint not null default 0 check (xp >= 0),
  level integer not null default 0 check (level >= 0),
  last_xp_ts bigint not null default 0, -- epoch ms, no timestamptz: Date.now() - last_xp_ts
  last_content text,
  xp_boost_until bigint not null default 0, -- epoch ms, item de tienda type:'xp_boost'
  prestige integer not null default 0 check (prestige >= 0), -- /prestigio
  primary key (guild_id, user_id)
);

-- =========================================================
-- Moderación
-- =========================================================
create table if not exists warnings (
  id bigint generated always as identity primary key,
  guild_id text not null,
  user_id text not null,
  reason text,
  moderator_id text not null,
  created_at timestamptz not null default now()
);
create index if not exists warnings_guild_user_idx on warnings (guild_id, user_id);

-- Historial persistente de bans/kicks/timeouts/punish/unban (/sanciones usuario:) — a
-- diferencia de warnings, estas acciones antes solo quedaban en el canal de logs.
create table if not exists moderation_actions (
  id bigint generated always as identity primary key,
  guild_id text not null,
  user_id text not null,
  action_type text not null, -- 'ban' | 'kick' | 'timeout' | 'timeout_remove' | 'punish' | 'punish_remove' | 'unban'
  moderator_id text not null,
  reason text,
  extra jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists moderation_actions_guild_user_idx on moderation_actions (guild_id, user_id);

-- Restricciones de /punish con expiración automática (opcional — si el staff no eligió
-- duración, /punish no crea fila acá y la restricción sigue siendo 100% manual como
-- siempre). PK (guild_id, user_id): una sola restricción con timer activo por usuario,
-- igual que ya garantiza el propio /punish (rechaza si el usuario ya tiene el rol).
create table if not exists active_punishments (
  guild_id text not null,
  user_id text not null,
  role_id text not null,
  expires_at bigint not null, -- epoch ms, mismo criterio que last_daily/last_work: Date.now() crudo, no timestamptz
  created_at bigint not null,
  primary key (guild_id, user_id)
);
create index if not exists active_punishments_expires_idx on active_punishments (expires_at);

-- =========================================================
-- Sorteos
-- =========================================================
create table if not exists giveaways (
  guild_id text not null,
  message_id text not null,
  channel_id text not null,
  prize text not null,
  winners_count integer not null default 1,
  end_timestamp bigint not null,
  ended boolean not null default false,
  cancelled boolean not null default false,
  winners jsonb not null default '[]',
  creator_id text not null,
  required_role_id text, -- rol requerido para participar (null = sin restricción)
  created_at timestamptz not null default now(),
  -- epoch ms; null = ganadores calculados (o el sorteo sigue activo) pero el anuncio
  -- todavía no se mandó. Ver giveawayEngine.js — separa "ended=true" de "se avisó de
  -- verdad", así un crash entre persistir ganadores y mandar el mensaje es recuperable
  -- al reiniciar (reconcilePendingGiveawayAnnouncements) en vez de perder el anuncio.
  winners_announced_at bigint,
  primary key (guild_id, message_id)
);
-- ended=false es lo único que rescheduleActiveGiveaways/toggleParticipant filtran, y la
-- tabla acumula historial (sorteos ya terminados nunca se borran) — sin este índice
-- parcial, ese filtro escanea filas de todos los servidores para siempre, no solo las
-- activas de ahora.
create index if not exists giveaways_active_idx on giveaways (ended) where ended = false;

-- Fase 2A.1 (2026-08-31) — getGiveawaysPendingAnnouncement() (giveawaysStore.js) filtra
-- exactamente estos 3 predicados; el índice parcial los repite tal cual para que
-- Postgres pueda resolverla contra un puñado de filas (los sorteos "atascados", en la
-- práctica casi siempre 0) en vez de escanear el historial completo de sorteos ya
-- anunciados. La corre tanto reconcilePendingGiveawayAnnouncements() al arrancar como
-- startGiveawayReconcileLoop() cada 5 minutos durante toda la vida del proceso.
create index if not exists giveaways_pending_announcement_idx on giveaways (guild_id, message_id)
  where ended = true and cancelled = false and winners_announced_at is null;

create table if not exists giveaway_entries (
  guild_id text not null,
  message_id text not null,
  user_id text not null,
  created_at timestamptz not null default now(),
  primary key (guild_id, message_id, user_id)
);

-- =========================================================
-- Trivia
-- =========================================================
create table if not exists trivia_user_stats (
  guild_id text not null,
  user_id text not null,
  points bigint not null default 0 check (points >= 0),
  correct integer not null default 0 check (correct >= 0),
  answered integer not null default 0 check (answered >= 0),
  answered_question_ids jsonb not null default '[]',
  plays_window_start bigint,
  plays_in_window integer not null default 0,
  primary key (guild_id, user_id)
);

-- =========================================================
-- Misiones diarias/semanales (/mision) — el catálogo (qué misiones existen, objetivo,
-- recompensa) vive fijo en código (src/utils/missionsStore.js), mismo criterio que
-- ACHIEVEMENTS en achievements.js: no configurable por servidor, no vale la pena la
-- superficie de admin para esto. Esta tabla solo guarda el PROGRESO de cada instancia
-- (una fila por usuario+misión+período) — period_start en la PK hace que cada ciclo
-- (cada día, cada semana) sea una fila nueva; las viejas quedan como historial liviano,
-- no se borran.
-- =========================================================
create table if not exists user_missions (
  guild_id text not null,
  user_id text not null,
  mission_id text not null, -- id del catálogo fijo, ej. 'daily_messages'
  period text not null, -- 'daily' | 'weekly'
  period_start bigint not null, -- epoch ms del inicio del ciclo (mismo criterio de siempre: aritmética con Date.now(), no timestamptz)
  progress integer not null default 0,
  target integer not null, -- copiado del catálogo al generar la fila — un cambio de catálogo después no altera una misión ya en curso
  reward_coins integer not null default 0,
  reward_xp integer not null default 0,
  completed_at bigint, -- epoch ms; null = todavía no se completó. Se paga en el mismo momento que se completa, no hay paso de "reclamar"
  primary key (guild_id, user_id, mission_id, period_start)
);
create index if not exists user_missions_guild_user_idx on user_missions (guild_id, user_id);

-- =========================================================
-- Logros (set fijo, definido en src/utils/achievements.js — esta tabla solo
-- guarda CUÁLES desbloqueó cada usuario, no la definición de cada uno)
-- =========================================================
create table if not exists achievements_unlocked (
  guild_id text not null,
  user_id text not null,
  achievement_id text not null,
  unlocked_at timestamptz not null default now(),
  primary key (guild_id, user_id, achievement_id)
);

-- =========================================================
-- Logros de servidor (colectivos) — mismo patrón que achievements_unlocked pero sin
-- user_id: se desbloquean una sola vez para todo el servidor, no por miembro.
-- =========================================================
create table if not exists guild_achievements_unlocked (
  guild_id text not null,
  achievement_id text not null,
  unlocked_at timestamptz not null default now(),
  primary key (guild_id, achievement_id)
);

-- =========================================================
-- Recordatorios (/recordatorio) — se entregan por DM, guild_id es solo referencia
-- de desde dónde se creó, no acota la entrega.
-- =========================================================
create table if not exists reminders (
  id bigint generated always as identity primary key,
  guild_id text not null,
  user_id text not null,
  message text not null,
  remind_at bigint not null, -- epoch ms, igual criterio que los cooldowns: aritmética cruda con Date.now()
  repeat_ms bigint, -- null = una sola vez; con valor, reminderEngine.js lo reprograma en vez de borrarlo
  created_at timestamptz not null default now()
);
create index if not exists reminders_remind_at_idx on reminders (remind_at);
-- getUserReminders filtra por guild_id+user_id y ordena por remind_at — la PK de esta
-- tabla es solo "id" (identity), a diferencia de la mayoría de las demás tablas donde
-- (guild_id, user_id) ES la PK y ya sirve de índice.
create index if not exists reminders_guild_user_idx on reminders (guild_id, user_id);

-- =========================================================
-- Confesiones (contador correlativo por servidor)
-- =========================================================
create table if not exists confession_counters (
  guild_id text primary key,
  counter bigint not null default 0
);

-- =========================================================
-- Plantillas guardadas de /anuncio ("Guardar plantilla" / "Cargar plantilla")
-- =========================================================
create table if not exists announcement_templates (
  id bigint generated always as identity primary key,
  guild_id text not null,
  name text not null,
  data jsonb not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (guild_id, name)
);

-- =========================================================
-- Métricas de uso agregadas (/metricas) — un contador por comando y servidor,
-- nunca eventos individuales: solo importa el total y la última vez usado.
-- =========================================================
create table if not exists command_usage (
  guild_id text not null,
  command_name text not null,
  uses bigint not null default 0,
  last_used_at timestamptz not null default now(),
  primary key (guild_id, command_name)
);

-- =========================================================
-- Analítica diaria por servidor (dashboard, Fase 5) — a diferencia del resto de tablas
-- de este archivo, acá "date" es un date real de Postgres (no epoch ms): esta tabla es
-- para reportes/series de tiempo, no para aritmética con Date.now() como los cooldowns.
--
-- Se llena EN VIVO por el Event Engine (increment_guild_daily_stat, sección RPCs), no
-- por un cron nocturno: no existe ningún otro lugar del esquema donde ya viva "mensajes
-- de hoy" o "comandos de hoy" para que un job los sume después — la única forma
-- correcta de tener esta granularidad es incrementar en el momento en que cada evento
-- pasa. Deliberadamente NO incluye active_members (necesitaría un conteo de usuarios
-- ÚNICOS, no un contador simple) — queda afuera a propósito, no es un olvido.
--
-- money_created: QUÉ CAMBIÓ (Fase A, segunda auditoría 2026-08-30) — ya no cuenta
-- cualquier monto positivo. Un ajuste de staff (/economia-staff dar) no suma, y una
-- ganancia de casino/caja misteriosa suma su ganancia NETA, no el payout bruto (ver
-- src/utils/economyOrigins.js, consumido por guildDailyStatsStore.js). Antes de este
-- cambio, ninguna de las dos distinciones existía.
--
-- money_destroyed: agregada en la misma fase. La primera versión de esta tabla la había
-- dejado afuera a propósito ("los gastos de este bot son una mezcla de sinks reales y
-- apuestas de casino que pueden volver — categorizarlos bien es más trabajo del que
-- vale para una primera versión"). Fase A hizo justo ese trabajo de categorización: solo
-- cuenta los dos sumideros reales ya documentados (multa de /crime, precio de una compra
-- en /shop — ver isDestructiveType en economyOrigins.js). Deliberadamente NO incluye
-- apuestas de casino perdidas — separarlas del payout bruto tocaría el flujo central de
-- casinoHelpers.js, fuera del alcance de esa fase.
-- =========================================================
create table if not exists guild_daily_stats (
  guild_id text not null,
  date date not null,
  messages_sent integer not null default 0 check (messages_sent >= 0),
  commands_executed integer not null default 0 check (commands_executed >= 0),
  new_members integer not null default 0 check (new_members >= 0),
  money_created bigint not null default 0 check (money_created >= 0),
  money_destroyed bigint not null default 0 check (money_destroyed >= 0),
  xp_distributed bigint not null default 0 check (xp_distributed >= 0),
  primary key (guild_id, date)
);

-- =========================================================
-- Estado del anunciador de patch notes de League of Legends
-- (src/utils/lolPatchEngine.js) — una sola fila fija, no es por guild: el canal de
-- anuncio está hardcodeado en el engine, no en guild_config.
-- =========================================================
create table if not exists lol_patch_state (
  id text primary key, -- fijo: 'league_of_legends'
  last_url text,
  updated_at timestamptz not null default now(),
  -- Monitor secundario de Data Dragon (src/utils/lolPatchMonitor.js) — nunca anuncia
  -- nada, solo detecta si el scraper de arriba dejó de encontrar artículos nuevos.
  last_ddragon_version text,
  ddragon_version_detected_at bigint, -- epoch ms, mismo criterio que last_daily/last_work (ver CLAUDE.md)
  ddragon_warning_sent_at bigint -- epoch ms; null = todavía no se avisó nada para la versión actual
);

-- =========================================================
-- RPCs atómicas
-- =========================================================

create or replace function increment_balance(p_guild_id text, p_user_id text, p_amount bigint)
returns bigint
language plpgsql
as $$
declare
  v_new_balance bigint;
begin
  insert into economy (guild_id, user_id, balance)
  values (p_guild_id, p_user_id, greatest(0, p_amount))
  on conflict (guild_id, user_id)
  do update set balance = greatest(0, economy.balance + p_amount)
  returning balance into v_new_balance;

  return v_new_balance;
end;
$$;

create or replace function deduct_balance_if_sufficient(p_guild_id text, p_user_id text, p_amount bigint)
returns bigint
language plpgsql
as $$
declare
  v_current bigint;
  v_new_balance bigint;
begin
  select balance into v_current
  from economy
  where guild_id = p_guild_id and user_id = p_user_id
  for update;

  if v_current is null or v_current < p_amount then
    raise exception 'insufficient_funds';
  end if;

  update economy
  set balance = balance - p_amount
  where guild_id = p_guild_id and user_id = p_user_id
  returning balance into v_new_balance;

  return v_new_balance;
end;
$$;

-- QUÉ CAMBIÓ (Fase 1, auditoría de seguridad/economía, 2026-08-30): agrega un piso
-- atómico en Postgres, igual criterio que greatest(0, ...) en increment_balance/
-- increment_xp — antes, dos consumos concurrentes del MISMO ítem (ej. /vender y /buy
-- revirtiendo una compra fallida sobre el mismo item_id, que usan locks de JS con keys
-- distintas — "vender:" vs "buy:" — y por lo tanto NUNCA se excluyen entre sí) podían
-- leer la misma cantidad vieja y dejar el inventario en negativo. "select ... for
-- update" bloquea la fila hasta que la primera transacción termina; la segunda, al
-- reanudar, relee la cantidad YA
-- actualizada y recién ahí calcula si su propio delta la manda por debajo de 0.
-- MOTIVO: el guard vivía solo en JS (el lock de asyncLock.js), que no cubre dos features
-- distintas tocando el mismo ítem a la vez.
create or replace function increment_inventory_item(p_guild_id text, p_user_id text, p_item_id text, p_qty integer)
returns jsonb
language plpgsql
as $$
declare
  v_inventory jsonb;
  v_new_qty integer;
begin
  select inventory into v_inventory
  from economy
  where guild_id = p_guild_id and user_id = p_user_id
  for update;

  v_new_qty := coalesce((v_inventory->>p_item_id)::integer, 0) + p_qty;
  if v_new_qty < 0 then
    raise exception 'insufficient_inventory';
  end if;

  insert into economy (guild_id, user_id, inventory)
  values (p_guild_id, p_user_id, jsonb_build_object(p_item_id, v_new_qty))
  on conflict (guild_id, user_id)
  do update set inventory = jsonb_set(economy.inventory, array[p_item_id], to_jsonb(v_new_qty))
  returning inventory into v_inventory;

  return v_inventory;
end;
$$;

create or replace function transfer_balance(p_guild_id text, p_sender_id text, p_receiver_id text, p_amount bigint)
returns table (sender_balance bigint, receiver_balance bigint)
language plpgsql
as $$
declare
  v_sender_balance bigint;
  v_receiver_balance bigint;
begin
  select balance into v_sender_balance
  from economy
  where guild_id = p_guild_id and user_id = p_sender_id
  for update;

  if v_sender_balance is null or v_sender_balance < p_amount then
    raise exception 'insufficient_funds';
  end if;

  update economy
  set balance = balance - p_amount
  where guild_id = p_guild_id and user_id = p_sender_id
  returning balance into v_sender_balance;

  insert into economy (guild_id, user_id, balance)
  values (p_guild_id, p_receiver_id, p_amount)
  on conflict (guild_id, user_id)
  do update set balance = economy.balance + p_amount
  returning balance into v_receiver_balance;

  return query select v_sender_balance, v_receiver_balance;
end;
$$;

create or replace function increment_xp(p_guild_id text, p_user_id text, p_amount bigint)
returns bigint
language plpgsql
as $$
declare
  v_new_xp bigint;
begin
  -- greatest(0, ...) igual que increment_balance: sin este piso atómico, dos /xp
  -- quitar concurrentes sobre el mismo usuario podían dejar la XP en negativo (el
  -- clamp que hace xpStaff.js en JS antes de llamar esto no protege contra la carrera,
  -- solo contra XP orgánica ganada en el medio).
  insert into xp (guild_id, user_id, xp)
  values (p_guild_id, p_user_id, greatest(0, p_amount))
  on conflict (guild_id, user_id)
  do update set xp = greatest(0, xp.xp + p_amount)
  returning xp into v_new_xp;

  return v_new_xp;
end;
$$;

-- /prestigio (Fase 2A, 2026-08-31): reemplaza el read->calculate->write que tenía
-- applyPrestige en xpStore.js por esta RPC atómica, mismo patrón que increment_xp/
-- increment_balance de arriba. "for update" bloquea la fila hasta que la primera
-- llamada termina — sin esto, dos /prestigio simultáneos del mismo usuario podían leer
-- el mismo prestige viejo y las dos escribir prestige+1, perdiendo un incremento (el
-- resultado final quedaba en +1 en vez de +2).
create or replace function apply_prestige(p_guild_id text, p_user_id text)
returns integer
language plpgsql
as $$
declare
  v_prestige integer;
begin
  select prestige into v_prestige
  from xp
  where guild_id = p_guild_id and user_id = p_user_id
  for update;

  v_prestige := coalesce(v_prestige, 0) + 1;

  insert into xp (guild_id, user_id, xp, level, prestige)
  values (p_guild_id, p_user_id, 0, 0, v_prestige)
  on conflict (guild_id, user_id)
  do update set xp = 0, level = 0, prestige = v_prestige;

  return v_prestige;
end;
$$;

-- Incrementa el progreso de UNA instancia de misión, clampeado al target, y marca
-- completed_at exactamente una vez (la primera llamada que cruza el target la completa;
-- llamadas posteriores a una misión ya completa no vuelven a pagar ni a sumar de más).
-- "for update" cubre el caso de dos eventos casi simultáneos incrementando la misma
-- misión (ej. dos mensajes elegibles procesados a la vez) — mismo motivo que
-- deduct_balance_if_sufficient. Devuelve just_completed=true SOLO en la llamada que
-- causó la finalización, así el caller (missionsStore.js) paga la recompensa una sola
-- vez sin necesitar su propio lock en memoria.
create or replace function increment_mission_progress(
  p_guild_id text, p_user_id text, p_mission_id text, p_period_start bigint, p_amount integer, p_now bigint
)
returns table (progress integer, target integer, just_completed boolean, reward_coins integer, reward_xp integer)
language plpgsql
as $$
declare
  v_progress integer;
  v_target integer;
  v_completed_at bigint;
  v_reward_coins integer;
  v_reward_xp integer;
  v_just_completed boolean;
begin
  select um.progress, um.target, um.completed_at, um.reward_coins, um.reward_xp
  into v_progress, v_target, v_completed_at, v_reward_coins, v_reward_xp
  from user_missions um
  where um.guild_id = p_guild_id and um.user_id = p_user_id and um.mission_id = p_mission_id and um.period_start = p_period_start
  for update;

  if v_progress is null then
    return; -- la fila todavía no existe — el caller siempre debe asegurarla antes (ensureCurrentMissions)
  end if;

  if v_completed_at is not null then
    return query select v_progress, v_target, false, v_reward_coins, v_reward_xp;
    return;
  end if;

  v_progress := least(v_target, v_progress + p_amount);
  v_just_completed := v_progress >= v_target;

  update user_missions um
  set progress = v_progress, completed_at = case when v_just_completed then p_now else null end
  where um.guild_id = p_guild_id and um.user_id = p_user_id and um.mission_id = p_mission_id and um.period_start = p_period_start;

  return query select v_progress, v_target, v_just_completed, v_reward_coins, v_reward_xp;
end;
$$;

-- Un solo upsert cubre las 6 métricas a la vez (los parámetros no usados quedan en 0,
-- que sumado no cambia nada) — evita 6 RPCs casi idénticas para cada columna suelta.
-- Cada handler del Event Engine (guildDailyStatsStore.js) llama esto con SOLO el
-- parámetro que le corresponde distinto de 0.
-- QUÉ CAMBIÓ (Fase A, segunda auditoría 2026-08-30): se agregó p_money_destroyed.
create or replace function increment_guild_daily_stat(
  p_guild_id text, p_date date,
  p_messages integer default 0, p_commands integer default 0, p_new_members integer default 0,
  p_money bigint default 0, p_xp bigint default 0, p_money_destroyed bigint default 0
)
returns void
language plpgsql
as $$
begin
  insert into guild_daily_stats (guild_id, date, messages_sent, commands_executed, new_members, money_created, xp_distributed, money_destroyed)
  values (p_guild_id, p_date, p_messages, p_commands, p_new_members, p_money, p_xp, p_money_destroyed)
  on conflict (guild_id, date) do update set
    messages_sent = guild_daily_stats.messages_sent + p_messages,
    commands_executed = guild_daily_stats.commands_executed + p_commands,
    new_members = guild_daily_stats.new_members + p_new_members,
    money_created = guild_daily_stats.money_created + p_money,
    xp_distributed = guild_daily_stats.xp_distributed + p_xp,
    money_destroyed = guild_daily_stats.money_destroyed + p_money_destroyed;
end;
$$;

create or replace function increment_confession_counter(p_guild_id text)
returns bigint
language plpgsql
as $$
declare
  v_new_counter bigint;
begin
  insert into confession_counters (guild_id, counter)
  values (p_guild_id, 1)
  on conflict (guild_id)
  do update set counter = confession_counters.counter + 1
  returning counter into v_new_counter;

  return v_new_counter;
end;
$$;

create or replace function increment_command_usage(p_guild_id text, p_command_name text)
returns void
language plpgsql
as $$
begin
  insert into command_usage (guild_id, command_name, uses, last_used_at)
  values (p_guild_id, p_command_name, 1, now())
  on conflict (guild_id, command_name)
  do update set uses = command_usage.uses + 1, last_used_at = now();
end;
$$;

-- p_now se pasa desde JS (Date.now()) en vez de usar now() de Postgres para quedar
-- consistente con el resto de los timestamps del bot (epoch ms, no timestamptz) — y
-- porque reiniciar last_interest_ts EN CADA depósito/retiro es lo que evita que un
-- depósito posterior a una cuenta vaciada cobre interés de un período en que el banco
-- estuvo en 0 (bug real, encontrado y corregido antes de sumar más features encima).
create or replace function deposit_to_bank(p_guild_id text, p_user_id text, p_amount bigint, p_now bigint)
returns table (wallet bigint, bank bigint)
language plpgsql
as $$
declare
  v_wallet bigint;
  v_bank bigint;
begin
  select balance into v_wallet
  from economy
  where guild_id = p_guild_id and user_id = p_user_id
  for update;

  if v_wallet is null or v_wallet < p_amount then
    raise exception 'insufficient_funds';
  end if;

  update economy
  set balance = balance - p_amount, bank = bank + p_amount, last_interest_ts = p_now
  where guild_id = p_guild_id and user_id = p_user_id
  returning balance, bank into v_wallet, v_bank;

  return query select v_wallet, v_bank;
end;
$$;

create or replace function withdraw_from_bank(p_guild_id text, p_user_id text, p_amount bigint, p_now bigint)
returns table (wallet bigint, bank bigint)
language plpgsql
as $$
declare
  v_wallet bigint;
  v_bank bigint;
begin
  select bank into v_bank
  from economy
  where guild_id = p_guild_id and user_id = p_user_id
  for update;

  if v_bank is null or v_bank < p_amount then
    raise exception 'insufficient_funds';
  end if;

  update economy
  set balance = balance + p_amount, bank = bank - p_amount, last_interest_ts = p_now
  where guild_id = p_guild_id and user_id = p_user_id
  returning balance, bank into v_wallet, v_bank;

  return query select v_wallet, v_bank;
end;
$$;

-- Une los dos UPDATE de cooldown de /rob (robber y víctima) en una sola llamada RPC:
-- antes eran dos updates independientes vía Promise.all() en JS — si el segundo fallaba
-- (red, rate limit de Supabase) después de que el primero ya había commiteado, el
-- robber quedaba con cooldown pero la víctima sin protección, pudiendo ser robada de
-- nuevo al instante. Al ser un solo plpgsql function body, Postgres lo corre como una
-- única transacción: o pegan los dos updates, o ninguno.
create or replace function set_rob_cooldowns(p_guild_id text, p_robber_id text, p_robber_ts bigint, p_victim_id text, p_victim_ts bigint)
returns void
language plpgsql
as $$
begin
  update economy set last_rob = p_robber_ts where guild_id = p_guild_id and user_id = p_robber_id;
  update economy set last_robbed = p_victim_ts where guild_id = p_guild_id and user_id = p_victim_id;
end;
$$;

create or replace function rob_wallet(p_guild_id text, p_robber_id text, p_victim_id text, p_percent numeric, p_max_amount bigint)
returns table (stolen bigint, robber_balance bigint, victim_balance bigint)
language plpgsql
as $$
declare
  v_victim_balance bigint;
  v_robber_balance bigint;
  v_stolen bigint;
begin
  select balance into v_victim_balance
  from economy
  where guild_id = p_guild_id and user_id = p_victim_id
  for update;

  if v_victim_balance is null or v_victim_balance <= 0 then
    raise exception 'nothing_to_steal';
  end if;

  v_stolen := least(p_max_amount, floor(v_victim_balance * p_percent));
  if v_stolen <= 0 then
    raise exception 'nothing_to_steal';
  end if;

  update economy
  set balance = balance - v_stolen
  where guild_id = p_guild_id and user_id = p_victim_id
  returning balance into v_victim_balance;

  insert into economy (guild_id, user_id, balance)
  values (p_guild_id, p_robber_id, v_stolen)
  on conflict (guild_id, user_id)
  do update set balance = economy.balance + v_stolen
  returning balance into v_robber_balance;

  return query select v_stolen, v_robber_balance, v_victim_balance;
end;
$$;

-- Fase 2C (performance/escalabilidad/operación, 2026-09-01) — dashboard/queries.js
-- traía todas las filas de economy/achievements_unlocked de un guild a Node solo para
-- sumarlas/agruparlas ahí (ver migration_2026_09_01_fase2c.sql para el detalle). Estas
-- dos son de solo lectura agregada, no escriben nada.
create or replace function sum_guild_balances(p_guild_id text)
returns bigint
language sql
stable
as $$
  select coalesce(sum(balance), 0)::bigint from economy where guild_id = p_guild_id;
$$;

create or replace function top_guild_achievers(p_guild_id text, p_limit integer default 5)
returns table(user_id text, unlock_count bigint)
language sql
stable
as $$
  select user_id, count(*) as unlock_count
  from achievements_unlocked
  where guild_id = p_guild_id
  group by user_id
  order by unlock_count desc, user_id
  limit p_limit;
$$;
