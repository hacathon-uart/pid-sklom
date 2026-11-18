-- Quiz best scores (ADR 0008). Additive: no catalogue, meme or guest-ledger changes.
-- Runs themselves are not stored; only each signed-in visitor's best score per quiz.
begin;

create table public.quiz_best_scores (
  user_id text not null,             -- same identity as memes.user_id
  quiz_key text not null check (quiz_key ~ '^(who|pairs|titles:[a-z0-9-]+)$'),
  best_score integer not null check (best_score >= 0),
  achieved_at timestamptz not null default now(),
  primary key (user_id, quiz_key)
);
alter table public.quiz_best_scores enable row level security;
revoke all on public.quiz_best_scores from public, anon, authenticated;
grant all on public.quiz_best_scores to service_role;

-- Keeps the higher score atomically and tells the caller whether this run set a new record.
create function public.quiz_record_score(p_user_id text, p_quiz_key text, p_score integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare previous integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id || '|' || p_quiz_key, 0));
  select best_score into previous from quiz_best_scores
    where user_id = p_user_id and quiz_key = p_quiz_key for update;
  if p_score <= 0 or (previous is not null and previous >= p_score) then
    -- A scoreless run is not a record.
    return jsonb_build_object('best_score', coalesce(previous, 0), 'new_record', false);
  end if;
  insert into quiz_best_scores (user_id, quiz_key, best_score) values (p_user_id, p_quiz_key, p_score)
    on conflict (user_id, quiz_key) do update
    set best_score = excluded.best_score, achieved_at = now()
    where quiz_best_scores.best_score < excluded.best_score;
  return jsonb_build_object('best_score', p_score, 'new_record', true);
end;
$$;

revoke all on function public.quiz_record_score(text, text, integer) from public, anon, authenticated;
grant execute on function public.quiz_record_score(text, text, integer) to service_role;

notify pgrst, 'reload schema';

commit;
