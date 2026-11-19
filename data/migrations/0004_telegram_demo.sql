-- Telegram-only tables/RPCs. Safe to rerun; never resets members or usage.
-- The first enrollment pins an event's expiry. Configuration may shorten that
-- expiry, but extending it requires a new event ID. Invite codes never enter SQL.
begin;

create table if not exists public.telegram_demo_events (
  event_id text primary key check (event_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ends_at timestamptz not null
);
create table if not exists public.telegram_demo_members (
  event_id text not null references public.telegram_demo_events(event_id),
  user_id bigint not null check (user_id > 0),
  enrolled_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create table if not exists public.telegram_demo_requests (
  event_id text not null,
  user_id bigint not null,
  request_key text not null check (request_key ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('pending', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  primary key (event_id, user_id, request_key),
  foreign key (event_id, user_id) references public.telegram_demo_members(event_id, user_id)
);
create index if not exists telegram_demo_reserved_idx
  on public.telegram_demo_requests (event_id, user_id)
  where state in ('pending', 'succeeded');
create unique index if not exists telegram_demo_one_pending_idx
  on public.telegram_demo_requests (event_id, user_id) where state = 'pending';

alter table public.telegram_demo_events enable row level security;
alter table public.telegram_demo_members enable row level security;
alter table public.telegram_demo_requests enable row level security;
revoke all on public.telegram_demo_events, public.telegram_demo_members,
  public.telegram_demo_requests from public, anon, authenticated;
grant all on public.telegram_demo_events, public.telegram_demo_members,
  public.telegram_demo_requests to service_role;

create or replace function public.telegram_demo_allowed(
  p_event_id text, p_ends_at timestamptz, p_user_id bigint
) returns boolean language sql security definer set search_path = pg_catalog, pg_temp as $$
  select exists (
    select 1 from public.telegram_demo_members m
    join public.telegram_demo_events e using (event_id)
    where m.event_id = p_event_id and m.user_id = p_user_id
      and clock_timestamp() < e.ends_at and clock_timestamp() < p_ends_at
  );
$$;

create or replace function public.telegram_demo_enroll(
  p_event_id text, p_ends_at timestamptz, p_user_id bigint
) returns text language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare expiry timestamptz;
begin
  if p_event_id is null or p_ends_at is null or p_user_id is null or p_user_id <= 0 then
    return 'closed';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('telegram-demo:' || p_event_id, 0));
  if clock_timestamp() >= p_ends_at then return 'closed'; end if;
  insert into public.telegram_demo_events (event_id, ends_at) values (p_event_id, p_ends_at)
    on conflict (event_id) do update
    set ends_at = least(telegram_demo_events.ends_at, excluded.ends_at);
  select ends_at into expiry from public.telegram_demo_events where event_id = p_event_id;
  if clock_timestamp() >= expiry then return 'closed'; end if;
  insert into public.telegram_demo_members (event_id, user_id) values (p_event_id, p_user_id)
    on conflict (event_id, user_id) do nothing;
  return 'enrolled';
end;
$$;

create or replace function public.telegram_demo_begin(
  p_event_id text, p_ends_at timestamptz, p_user_id bigint,
  p_request_key text, p_quota integer, p_global_quota integer, p_max_concurrent integer
) returns text language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare used_global bigint; used_user bigint;
begin
  -- All mutations share one event lock: quota checks include concurrent reservations.
  perform pg_advisory_xact_lock(hashtextextended('telegram-demo:' || p_event_id, 0));
  if p_quota is null or p_global_quota is null or p_quota < 0 or p_global_quota < 0
    or p_max_concurrent is null or p_max_concurrent < 1
    or p_ends_at is null or not public.telegram_demo_allowed(p_event_id, p_ends_at, p_user_id) then
    return 'closed';
  end if;
  -- Crash recovery keeps uncertain work charged, rather than releasing a slot
  -- that an unfenced late worker may still complete. Late finish is then a no-op.
  update public.telegram_demo_requests set state = 'succeeded', finished_at = clock_timestamp()
    where event_id = p_event_id and state = 'pending'
      and started_at <= clock_timestamp() - interval '5 minutes';
  if exists (select 1 from public.telegram_demo_requests
      where event_id = p_event_id and user_id = p_user_id and request_key = p_request_key) then
    return 'duplicate';
  end if;
  if exists (select 1 from public.telegram_demo_requests
      where event_id = p_event_id and user_id = p_user_id and state = 'pending') then
    return 'busy';
  end if;
  select count(*), count(*) filter (where user_id = p_user_id)
    into used_global, used_user from public.telegram_demo_requests
    where event_id = p_event_id and state in ('pending', 'succeeded');
  if used_user >= p_quota or used_global >= p_global_quota then return 'limited'; end if;
  if (select count(*) from public.telegram_demo_requests
      where event_id = p_event_id and state = 'pending') >= p_max_concurrent then
    return 'busy';
  end if;
  insert into public.telegram_demo_requests (event_id, user_id, request_key, state)
    values (p_event_id, p_user_id, p_request_key, 'pending');
  return 'started';
end;
$$;

create or replace function public.telegram_demo_finish(
  p_event_id text, p_user_id bigint, p_request_key text, p_success boolean
) returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('telegram-demo:' || p_event_id, 0));
  if p_success is null then raise exception 'Success is required'; end if;
  update public.telegram_demo_requests
    set state = case when p_success then 'succeeded' else 'failed' end,
        finished_at = clock_timestamp()
    where event_id = p_event_id and user_id = p_user_id
      and request_key = p_request_key and state = 'pending';
  return 'null'::jsonb;
end;
$$;

revoke all on function public.telegram_demo_allowed(text, timestamptz, bigint),
  public.telegram_demo_enroll(text, timestamptz, bigint),
  public.telegram_demo_begin(text, timestamptz, bigint, text, integer, integer, integer),
  public.telegram_demo_finish(text, bigint, text, boolean) from public, anon, authenticated;
grant execute on function public.telegram_demo_allowed(text, timestamptz, bigint),
  public.telegram_demo_enroll(text, timestamptz, bigint),
  public.telegram_demo_begin(text, timestamptz, bigint, text, integer, integer, integer),
  public.telegram_demo_finish(text, bigint, text, boolean) to service_role;

notify pgrst, 'reload schema';
commit;
