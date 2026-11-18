-- Apply once before enabling Google accounts/guest limits. No catalogue or Storage changes.
begin;

create table public.app_operations (
  actor text not null,
  request_id uuid not null,
  kind text not null check (kind in ('match', 'captions', 'save')),
  payload_hash text not null,
  state text not null check (state in ('pending', 'complete', 'failed')),
  lease uuid not null,
  lease_until timestamptz not null,
  response jsonb,
  primary key (actor, request_id)
);
alter table public.app_operations enable row level security;
revoke all on public.app_operations from public, anon, authenticated;
grant all on public.app_operations to service_role;

create function public.operation_remaining(p_actor text)
returns integer language sql security definer set search_path = public, pg_temp as $$
  select greatest(0, 3 - count(*)::integer) from app_operations
  where actor = p_actor and kind in ('match', 'captions')
    and (state = 'complete' or (state = 'pending' and lease_until > now()));
$$;

create function public.operation_begin(
  p_actor text, p_request_id uuid, p_kind text, p_payload_hash text, p_limited boolean
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare existing app_operations; token uuid := gen_random_uuid();
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor, 0));
  select * into existing from app_operations
    where actor = p_actor and request_id = p_request_id;
  if found then
    if existing.payload_hash <> p_payload_hash or existing.kind <> p_kind then
      return jsonb_build_object('status', 'conflict');
    end if;
    if existing.state = 'complete' then
      return jsonb_build_object('status', 'complete', 'response', existing.response);
    end if;
    if existing.state = 'pending' and existing.lease_until > now() then
      return jsonb_build_object('status', 'pending');
    end if;
  end if;
  if p_limited and operation_remaining(p_actor) = 0 then
    return jsonb_build_object('status', 'limited');
  end if;
  insert into app_operations values (
    p_actor, p_request_id, p_kind, p_payload_hash, 'pending', token,
    now() + interval '120 seconds', null
  ) on conflict (actor, request_id) do update
    set state = 'pending', lease = token, lease_until = now() + interval '120 seconds';
  return jsonb_build_object('status', 'started', 'lease', token);
end;
$$;

create function public.operation_finish(
  p_actor text, p_request_id uuid, p_lease uuid, p_response jsonb, p_success boolean
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor, 0));
  update app_operations set state = case when p_success then 'complete' else 'failed' end,
    response = p_response
    where actor = p_actor and request_id = p_request_id and lease = p_lease
      and state = 'pending' and lease_until > now();
  return found;
end;
$$;

revoke all on function public.operation_remaining(text) from public, anon, authenticated;
revoke all on function public.operation_begin(text, uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.operation_finish(text, uuid, uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.operation_remaining(text) to service_role;
grant execute on function public.operation_begin(text, uuid, text, text, boolean) to service_role;
grant execute on function public.operation_finish(text, uuid, uuid, jsonb, boolean) to service_role;

commit;
