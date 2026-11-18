-- Apply once after 0001, before enabling GUEST_EXPORT_LIMIT_ENABLED.
-- Existing identities, generations, saved memes, catalogue and Storage are unchanged.
begin;

alter table public.app_operations drop constraint app_operations_kind_check;
alter table public.app_operations add constraint app_operations_kind_check
  check (kind in ('match', 'captions', 'save', 'export'));

create function public.export_remaining(p_actor text)
returns integer language sql security definer set search_path = public, pg_temp as $$
  select greatest(0, 3 - count(*)::integer) from app_operations
  where actor = p_actor and kind = 'export'
    and (state = 'complete' or (state = 'pending' and lease_until > now()));
$$;

create or replace function public.operation_begin(
  p_actor text, p_request_id uuid, p_kind text, p_payload_hash text, p_limited boolean
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare existing app_operations; token uuid := gen_random_uuid(); available integer;
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
  if p_limited then
    available := case when p_kind = 'export'
      then export_remaining(p_actor) else operation_remaining(p_actor) end;
    if available = 0 then
      return jsonb_build_object('status', 'limited');
    end if;
  end if;
  insert into app_operations values (
    p_actor, p_request_id, p_kind, p_payload_hash, 'pending', token,
    now() + interval '120 seconds', null
  ) on conflict (actor, request_id) do update
    set state = 'pending', lease = token, lease_until = now() + interval '120 seconds';
  return jsonb_build_object('status', 'started', 'lease', token);
end;
$$;

revoke all on function public.export_remaining(text) from public, anon, authenticated;
grant execute on function public.export_remaining(text) to service_role;

notify pgrst, 'reload schema';

commit;
