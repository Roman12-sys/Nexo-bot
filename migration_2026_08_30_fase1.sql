-- Migración: Fase 1 (auditoría de seguridad/economía, 2026-08-30)
-- Correr ENTERO en el SQL Editor del proyecto Supabase REAL (gmcqbvrqqpmcqjrbtauk,
-- NO el viejo de gNoX wglbcbwgrtadcnavtpxg). Verificar después contra la API/tabla real,
-- no confiar solo en el "Success" del editor — no hay forma de confirmar desde este
-- entorno si esta migración ya corrió contra producción o no.

-- 1) Columna faltante que el código ya usa (economyStore.js: getGuildPurchasesByReason,
--    markPurchaseDelivered — sin esto, /economia-staff pendientes falla con
--    "column economy_transactions.delivered does not exist").
alter table economy_transactions add column if not exists delivered boolean not null default false;

-- 2) Guard atómico contra inventario negativo: dos consumos concurrentes del mismo ítem
--    por FEATURES distintas (ej. /vender y /pet alimentar sobre el mismo item_id — usan
--    locks de JS con keys distintas, "vender:" vs "pet:", que nunca se excluyen entre
--    sí) podían dejar la cantidad en negativo. "select ... for update" bloquea la fila
--    hasta que la primera transacción termina; la segunda relee la cantidad YA
--    actualizada antes de calcular su propio delta.
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
