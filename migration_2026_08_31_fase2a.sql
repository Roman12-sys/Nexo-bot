-- Migración: Fase 2A (database + recovery + concurrencia, 2026-08-31)
-- Correr ENTERO en el SQL Editor del proyecto Supabase REAL (gmcqbvrqqpmcqjrbtauk,
-- NO el viejo de gNoX wglbcbwgrtadcnavtpxg). Verificar después contra la API/tabla real,
-- no confiar solo en el "Success" del editor.
--
-- Todo acá es idempotente: se puede correr más de una vez sin romper nada. Los CHECK
-- constraints van en bloques DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL $$
-- porque Postgres NO soporta "ADD CONSTRAINT IF NOT EXISTS" (a diferencia de ADD COLUMN,
-- que sí lo soporta directo).

-- =========================================================
-- 1) Recovery de sorteos (Bloque 1) — separa "ganadores calculados" de "ya se avisó",
--    para poder recuperarse de un crash entre persistir ganadores y mandar el anuncio.
--    Ver src/utils/giveawayEngine.js.
-- =========================================================
alter table giveaways add column if not exists winners_announced_at bigint;

-- =========================================================
-- 2) Índice parcial de sorteos activos (Bloque 5) — getActiveGiveaways()/
--    toggleParticipant filtran por ended=false sin guild_id, y la tabla acumula
--    historial completo (sorteos terminados nunca se borran). Sin esto, ese filtro
--    escanea filas de TODOS los servidores para siempre, no solo las activas de ahora.
-- =========================================================
create index if not exists giveaways_active_idx on giveaways (ended) where ended = false;

-- =========================================================
-- 3) Constraints de integridad (Bloque 4) — invariantes reales del negocio,
--    verificadas contra cada call-site de escritura antes de agregarlas (ver informe
--    de Fase 2A). Cada una es la red de seguridad a nivel de tabla para una invariante
--    que el código en JS/las RPCs de Postgres ya debían respetar — cierran el caso de
--    una escritura directa que bypasee esa capa.
-- =========================================================
do $$ begin
  alter table economy add constraint economy_balance_nonneg check (balance >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table economy add constraint economy_bank_nonneg check (bank >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table economy add constraint economy_daily_streak_nonneg check (daily_streak >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table economy add constraint economy_rob_shield_until_nonneg check (rob_shield_until >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table xp add constraint xp_xp_nonneg check (xp >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table xp add constraint xp_level_nonneg check (level >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table xp add constraint xp_prestige_nonneg check (prestige >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table shop_items add constraint shop_items_price_positive check (price > 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table pets add constraint pets_level_nonneg check (level >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table pets add constraint pets_xp_nonneg check (xp >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table pets add constraint pets_hunger_range check (hunger between 0 and 100);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table pets add constraint pets_happiness_range check (happiness between 0 and 100);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table pets add constraint pets_wins_nonneg check (wins >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table pets add constraint pets_losses_nonneg check (losses >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table voice_channel_stats add constraint voice_channel_stats_duration_nonneg check (duration_seconds >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table voice_channel_stats add constraint voice_channel_stats_unique_users_nonneg check (unique_users_count >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table voice_channel_stats add constraint voice_channel_stats_max_concurrent_nonneg check (max_concurrent_users >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table trivia_user_stats add constraint trivia_user_stats_points_nonneg check (points >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table trivia_user_stats add constraint trivia_user_stats_correct_nonneg check (correct >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table trivia_user_stats add constraint trivia_user_stats_answered_nonneg check (answered >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table guild_daily_stats add constraint guild_daily_stats_messages_nonneg check (messages_sent >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table guild_daily_stats add constraint guild_daily_stats_commands_nonneg check (commands_executed >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table guild_daily_stats add constraint guild_daily_stats_new_members_nonneg check (new_members >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table guild_daily_stats add constraint guild_daily_stats_money_created_nonneg check (money_created >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table guild_daily_stats add constraint guild_daily_stats_money_destroyed_nonneg check (money_destroyed >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table guild_daily_stats add constraint guild_daily_stats_xp_distributed_nonneg check (xp_distributed >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table temporary_voice_channels add constraint temporary_voice_channels_type_enum check (type in ('public', 'private', 'invite_only'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table guild_config add constraint guild_config_level_roles_mode_enum check (level_roles_mode in ('cumulative', 'replace'));
exception when duplicate_object then null; end $$;

-- economy_transactions.type queda A PROPÓSITO sin CHECK — ver el comentario extendido
-- en schema.sql. Esta lista crece con cada feature nueva de economía; un CHECK
-- desincronizado rompería inserts legítimos en producción de forma silenciosa (ya pasó
-- una vez con el comentario, que quedó desactualizado sin que nadie lo notara).

-- =========================================================
-- 4) Prestigio atómico (Bloque 6) — reemplaza el read→calculate→write de applyPrestige
--    (xpStore.js) por una RPC con "for update", mismo patrón que increment_xp/
--    increment_balance. Sin esto, dos /prestigio simultáneos podían leer el mismo
--    "prestige" viejo y los dos escribir prestige+1, perdiendo un incremento.
-- =========================================================
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
