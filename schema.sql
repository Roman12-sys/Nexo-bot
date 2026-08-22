-- Nexo Bot — schema inicial de Supabase
-- Basado en el esquema de gNoX (guild_id ya es parte de la PK en todas las tablas de stores),
-- generalizando el patrón de voice_channel_config a una tabla guild_config única.
-- Pegar completo en el SQL Editor del proyecto Supabase nuevo.

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

  -- niveles
  level_roles jsonb not null default '{}',
  level_roles_mode text not null default 'cumulative',

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
  type text not null default 'public', -- 'private' | 'invite_only' | 'public'
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
  duration_seconds integer not null default 0,
  unique_users_count integer not null default 0,
  max_concurrent_users integer not null default 0
);

-- =========================================================
-- Economía
-- =========================================================
create table if not exists economy (
  guild_id text not null,
  user_id text not null,
  balance bigint not null default 0,
  last_daily bigint not null default 0, -- epoch ms, no timestamptz: el bot hace Date.now() - last_daily
  last_work bigint not null default 0,  -- idem
  inventory jsonb not null default '{}',
  primary key (guild_id, user_id)
);

create table if not exists economy_transactions (
  id bigint generated always as identity primary key,
  guild_id text not null,
  user_id text not null,
  type text not null, -- 'daily' | 'work' | 'trivia' | 'guess' | 'purchase' | 'transfer_in' | 'transfer_out' | 'admin_add' | 'admin_remove' | 'admin_set'
  amount bigint not null,
  balance_after bigint not null,
  actor_id text,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists economy_transactions_guild_user_idx on economy_transactions (guild_id, user_id);

-- =========================================================
-- XP / niveles
-- =========================================================
create table if not exists xp (
  guild_id text not null,
  user_id text not null,
  xp bigint not null default 0,
  level integer not null default 0,
  last_xp_ts bigint not null default 0, -- epoch ms, no timestamptz: Date.now() - last_xp_ts
  last_content text,
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
  created_at timestamptz not null default now(),
  primary key (guild_id, message_id)
);

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
  points bigint not null default 0,
  correct integer not null default 0,
  answered integer not null default 0,
  answered_question_ids jsonb not null default '[]',
  plays_window_start bigint,
  plays_in_window integer not null default 0,
  primary key (guild_id, user_id)
);

-- =========================================================
-- Reputación
-- =========================================================
create table if not exists reputation (
  guild_id text not null,
  user_id text not null,
  total bigint not null default 0,
  last_given bigint not null default 0, -- epoch ms, no timestamptz: Date.now() - last_given
  primary key (guild_id, user_id)
);

-- =========================================================
-- Confesiones (contador correlativo por servidor)
-- =========================================================
create table if not exists confession_counters (
  guild_id text primary key,
  counter bigint not null default 0
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

create or replace function increment_inventory_item(p_guild_id text, p_user_id text, p_item_id text, p_qty integer)
returns jsonb
language plpgsql
as $$
declare
  v_inventory jsonb;
begin
  insert into economy (guild_id, user_id, inventory)
  values (p_guild_id, p_user_id, jsonb_build_object(p_item_id, p_qty))
  on conflict (guild_id, user_id)
  do update set inventory = jsonb_set(
    economy.inventory,
    array[p_item_id],
    to_jsonb(coalesce((economy.inventory->>p_item_id)::integer, 0) + p_qty)
  )
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
  insert into xp (guild_id, user_id, xp)
  values (p_guild_id, p_user_id, p_amount)
  on conflict (guild_id, user_id)
  do update set xp = xp.xp + p_amount
  returning xp into v_new_xp;

  return v_new_xp;
end;
$$;

create or replace function increment_reputation(p_guild_id text, p_user_id text, p_amount bigint)
returns bigint
language plpgsql
as $$
declare
  v_new_total bigint;
begin
  insert into reputation (guild_id, user_id, total)
  values (p_guild_id, p_user_id, p_amount)
  on conflict (guild_id, user_id)
  do update set total = reputation.total + p_amount
  returning total into v_new_total;

  return v_new_total;
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
