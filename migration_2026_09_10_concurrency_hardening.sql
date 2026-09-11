-- Migración: hardening de concurrencia (auditoría adversarial round 2, Bloques 4 y 5B)
-- Correr ENTERO en el SQL Editor del proyecto Supabase REAL (gmcqbvrqqpmcqjrbtauk,
-- NO el viejo de gNoX wglbcbwgrtadcnavtpxg). Verificar después contra la función real
-- (select prosrc from pg_proc where proname = '...' — ver la query exacta al final de
-- este archivo), no confiar solo en el "Success" del editor.
--
-- Esta migración NO cambia ninguna columna ni tabla existente, y NO tiene ningún DROP.
-- Son 4 `create or replace function`:
--   - transfer_balance, rob_wallet, set_rob_cooldowns: YA EXISTÍAN — se reemplaza
--     únicamente el CUERPO, la firma (nombre + parámetros + tipo de retorno) no
--     cambia. Segura de correr en cualquier momento, incluso antes de desplegar el
--     código de src/commands/economia/rob.js (que solo cambió el orden de locks de
--     JS, no la firma de las RPCs que llama).
--   - set_balance: función NUEVA. No pisa ninguna firma existente (nombre nuevo) y no
--     depende de ninguna columna/tabla que no exista ya (usa `economy`, ya creada en
--     schema.sql). El código que la llama (src/utils/economyStore.js `setBalance`)
--     SÍ depende de que esta función exista — a diferencia de las otras 3, correr el
--     código nuevo ANTES de esta migración rompería `/economia-staff establecer` con
--     un error de Postgres "function set_balance does not exist" hasta que se corra.
--     Mismo criterio de orden que el resto del proyecto: correr esta migración ANTES
--     o junto con el deploy del código, no después.
--
-- Motivo (transfer_balance/rob_wallet/set_rob_cooldowns): bloqueaban las dos filas de
-- `economy` que tocan en un orden fijo por ROL (emisor->receptor, víctima->robber), no
-- por identidad de cuenta. Dos operaciones cruzadas entre el mismo par de usuarios al
-- mismo tiempo (A->B y B->A vía /give, o un /give cruzado con un /rob sobre las
-- mismas dos cuentas) podían tomar los locks en orden opuesto y terminar en deadlock
-- real de Postgres (40P01). Fix: las 3 funciones ahora bloquean/actualizan SIEMPRE en
-- orden de user_id ascendente, nunca por rol.
--
-- Motivo (set_balance): /economia-staff establecer hacía una lectura en JS del
-- balance "antes" sin ningún lock, y recién después escribía el valor absoluto — un
-- /give, /rob o /daily concurrente que cambiara el balance en esa ventana dejaba un
-- delta INCORRECTO en economy_transactions (nunca corrompía el balance final en sí,
-- que ya era un set absoluto correcto — la semántica de "establecer" es
-- intencionalmente "balance final = X, ignorando cualquier cambio concurrente", eso
-- NO cambió). set_balance bloquea la fila (for update) ANTES de leer "antes", así
-- que el delta que queda en el historial es siempre el real.

create or replace function transfer_balance(p_guild_id text, p_sender_id text, p_receiver_id text, p_amount bigint)
returns table (sender_balance bigint, receiver_balance bigint)
language plpgsql
as $$
declare
  v_sender_balance bigint;
  v_receiver_balance bigint;
begin
  insert into economy (guild_id, user_id) values (p_guild_id, p_sender_id) on conflict do nothing;
  insert into economy (guild_id, user_id) values (p_guild_id, p_receiver_id) on conflict do nothing;

  -- QUÉ CAMBIÓ: antes bloqueaba primero al EMISOR (SELECT...FOR UPDATE) y recién
  -- después al RECEPTOR (vía el UPSERT) — orden fijo por rol, no por identidad de
  -- cuenta. Un `SELECT ... ORDER BY ... FOR UPDATE` no sirve para forzar el orden de
  -- bloqueo (Postgres aplica el LockRows del plan ANTES del Sort) — se fuerza con dos
  -- sentencias secuenciales explícitas.
  if p_sender_id < p_receiver_id then
    perform 1 from economy where guild_id = p_guild_id and user_id = p_sender_id for update;
    perform 1 from economy where guild_id = p_guild_id and user_id = p_receiver_id for update;
  else
    perform 1 from economy where guild_id = p_guild_id and user_id = p_receiver_id for update;
    perform 1 from economy where guild_id = p_guild_id and user_id = p_sender_id for update;
  end if;

  select balance into v_sender_balance
  from economy
  where guild_id = p_guild_id and user_id = p_sender_id;

  if v_sender_balance is null or v_sender_balance < p_amount then
    raise exception 'insufficient_funds';
  end if;

  update economy
  set balance = balance - p_amount
  where guild_id = p_guild_id and user_id = p_sender_id
  returning balance into v_sender_balance;

  update economy
  set balance = balance + p_amount
  where guild_id = p_guild_id and user_id = p_receiver_id
  returning balance into v_receiver_balance;

  return query select v_sender_balance, v_receiver_balance;
end;
$$;

create or replace function set_rob_cooldowns(p_guild_id text, p_robber_id text, p_robber_ts bigint, p_victim_id text, p_victim_ts bigint)
returns void
language plpgsql
as $$
begin
  if p_robber_id < p_victim_id then
    update economy set last_rob = p_robber_ts where guild_id = p_guild_id and user_id = p_robber_id;
    update economy set last_robbed = p_victim_ts where guild_id = p_guild_id and user_id = p_victim_id;
  else
    update economy set last_robbed = p_victim_ts where guild_id = p_guild_id and user_id = p_victim_id;
    update economy set last_rob = p_robber_ts where guild_id = p_guild_id and user_id = p_robber_id;
  end if;
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
  insert into economy (guild_id, user_id) values (p_guild_id, p_robber_id) on conflict do nothing;
  insert into economy (guild_id, user_id) values (p_guild_id, p_victim_id) on conflict do nothing;

  if p_robber_id < p_victim_id then
    perform 1 from economy where guild_id = p_guild_id and user_id = p_robber_id for update;
    perform 1 from economy where guild_id = p_guild_id and user_id = p_victim_id for update;
  else
    perform 1 from economy where guild_id = p_guild_id and user_id = p_victim_id for update;
    perform 1 from economy where guild_id = p_guild_id and user_id = p_robber_id for update;
  end if;

  select balance into v_victim_balance
  from economy
  where guild_id = p_guild_id and user_id = p_victim_id;

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

  update economy
  set balance = balance + v_stolen
  where guild_id = p_guild_id and user_id = p_robber_id
  returning balance into v_robber_balance;

  return query select v_stolen, v_robber_balance, v_victim_balance;
end;
$$;

create or replace function set_balance(p_guild_id text, p_user_id text, p_amount bigint)
returns table (balance_before bigint, balance_after bigint)
language plpgsql
as $$
declare
  v_before bigint;
  v_after bigint;
begin
  insert into economy (guild_id, user_id) values (p_guild_id, p_user_id) on conflict do nothing;

  select balance into v_before
  from economy
  where guild_id = p_guild_id and user_id = p_user_id
  for update;

  v_after := greatest(0, p_amount);

  update economy
  set balance = v_after
  where guild_id = p_guild_id and user_id = p_user_id;

  return query select coalesce(v_before, 0), v_after;
end;
$$;

-- ---------------------------------------------------------------------------
-- VERIFICACIÓN POST-MIGRACIÓN (correr en el mismo SQL Editor, después de lo de
-- arriba, contra la base REAL) — confirma que las 4 funciones quedaron con el
-- cuerpo nuevo, no solo que el editor dijo "Success".
-- ---------------------------------------------------------------------------
select
  proname as function_name,
  pg_get_functiondef(oid) as definition
from pg_proc
where proname in ('transfer_balance', 'rob_wallet', 'set_rob_cooldowns', 'set_balance')
order by proname;

-- Chequeo puntual más rápido de leer, solo para las 3 funciones que tocan 2 cuentas:
-- confirma que tienen el `if ... < ... then` de orden determinístico (el patrón
-- viejo, por rol, no tenía ningún `if` de este tipo). Debería devolver 3 filas, las
-- 3 con has_ordered_lock_check = true.
select
  proname as function_name,
  pg_get_functiondef(oid) like '%< p_%' as has_ordered_lock_check
from pg_proc
where proname in ('transfer_balance', 'rob_wallet', 'set_rob_cooldowns')
order by proname;

-- set_balance toca una sola cuenta (no aplica el chequeo de orden) — confirmar solo
-- que existe y que bloquea antes de leer "antes" (contiene "for update" ANTES del
-- "update ... set balance").
select proname, pg_get_functiondef(oid) like '%for update%' as has_row_lock
from pg_proc
where proname = 'set_balance';
