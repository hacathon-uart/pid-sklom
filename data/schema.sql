-- Supabase Postgres schema (T04). Run in Supabase → SQL editor.
-- Columns match data/seed/*.json exactly, so the import script can upsert rows as-is.
-- Why it looks like this: docs/adr/0001-artwork-data-storage.md

create extension if not exists vector;

create table if not exists artists (
  id           bigint primary key,
  wikidata_id  text unique,                    -- «Q134958»; import scripts match rows by it
  slug         text unique not null,
  name_uk      text not null,
  birth_year   int,
  death_year   int,
  birth_place  text,
  short_bio    text not null default '',
  long_bio     text not null default '',
  portrait_url text,
  sources      text[] not null default '{}',
  updated_at   timestamptz not null default now()
);

create table if not exists artworks (
  id                bigint primary key,
  wikidata_id       text unique,                -- «Q111822246»; import scripts match rows by it
  slug              text unique not null,
  artist_id         bigint not null references artists(id),
  title_uk          text not null,
  year              int,
  museum            text,
  medium            text,                       -- «полотно, олія» (author page)
  genre             text check (genre in ('portrait','landscape','everyday','avantgarde')),
  about_uk          text not null default '',   -- «Про картину» in the StoryCard
  image_url         text not null,              -- 1200 px long side
  thumb_url         text not null,              -- 400 px
  license           text,
  source_url        text,
  is_featured       boolean not null default false, -- «Найвідоміша картина» on the author page
  tags              text[] not null default '{}',
  -- Full AI profile: {visual_description, people[], mood[], meme_situations[], do_not_use_for[],
  -- caption_position, confidence, model, prompt_version, generated_at, review{reviewer, notes}}
  meme_profile      jsonb,
  -- Copied out of the profile because we filter and sort by them:
  review_status     text not null default 'pending'
                    check (review_status in ('pending','approved','rejected')), -- only approved go live
  is_sensitive      boolean not null default false, -- tragic / religious: no jokes
  meme_potential    smallint check (meme_potential between 1 and 5),
  fallback_captions text[] not null default '{}',
  embedding_text    text,                       -- exactly the text that was embedded
  embedding         vector(1536),               -- dimension depends on the model; fixed once the provider is chosen
  embedding_model   text,                       -- which model produced `embedding`
  updated_at        timestamptz not null default now()
);
create index if not exists artworks_artist on artworks (artist_id);
create index if not exists artworks_status on artworks (review_status);
create index if not exists artworks_tags   on artworks using gin (tags);

create table if not exists facts (
  id         bigint primary key,
  artist_id  bigint references artists(id),
  artwork_id bigint references artworks(id),
  text_uk    text not null,
  source_url text,
  verified   boolean not null default false,
  check ((artist_id is null) <> (artwork_id is null))
);
create index if not exists facts_artist  on facts (artist_id);
create index if not exists facts_artwork on facts (artwork_id);

-- Keep updated_at honest on every upsert.
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists artists_touch  on artists;
drop trigger if exists artworks_touch on artworks;
create trigger artists_touch  before update on artists  for each row execute function touch_updated_at();
create trigger artworks_touch before update on artworks for each row execute function touch_updated_at();

create table if not exists memes (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null,                    -- Supabase auth user id (uuid as text) or a stub user in dev
  artwork_id  bigint not null references artworks(id),
  caption     text not null,
  style       jsonb not null,                   -- MemeStyle (backend/app/schemas.py)
  image_url   text,
  is_favorite boolean not null default false,
  created_at  timestamptz not null default now()
);
-- Migration for projects created with the earlier schema (user_id uuid + foreign key to auth.users):
alter table memes drop constraint if exists memes_user_id_fkey;
alter table memes alter column user_id type text using user_id::text;
alter table memes alter column user_id set not null;
create index if not exists memes_user_created on memes (user_id, created_at desc);

-- The backend uses the service key and does its own checks, so RLS mainly protects
-- against the public anon key. Content is read-only for everyone; memes are private.
alter table artists  enable row level security;
alter table artworks enable row level security;
alter table facts    enable row level security;
alter table memes    enable row level security;
drop policy if exists "public read" on artists;
drop policy if exists "public read" on artworks;
drop policy if exists "public read" on facts;
create policy "public read" on artists  for select using (true);
create policy "public read" on artworks for select using (review_status = 'approved');
-- A verified fact about a hidden artwork must stay hidden too.
create policy "public read" on facts for select using (
  verified and (artwork_id is null or exists (
    select 1 from artworks a where a.id = artwork_id and a.review_status = 'approved'))
);
-- memes: no policies on purpose = the anon key can do nothing; only the backend (service key) touches it.

-- Storage buckets, public read. Uploads need the service key (it bypasses Storage RLS).
-- «artworks» holds artwork images + thumbs (<slug>.jpg, <slug>-thumb.jpg) and artist portraits (portraits/<slug>.jpg).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('artworks', 'artworks', true, 5242880, array['image/jpeg','image/png','image/webp']),
  ('memes',    'memes',    true, 5242880, array['image/png'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Vector search over approved artworks (used from Day 3-4; harmless before). 150 rows: exact scan, no index needed.
create or replace function match_artworks(query_embedding vector(1536), match_count int default 5)
returns table (id bigint, similarity float) language sql stable as $$
  select a.id, 1 - (a.embedding <=> query_embedding) as similarity
  from artworks a
  where a.review_status = 'approved' and a.embedding is not null
  order by a.embedding <=> query_embedding
  limit match_count;
$$;

-- Table privileges. The project is created with «Automatically expose new tables» OFF, so nothing
-- is reachable through the Data API until granted here. RLS policies above then narrow it down.
grant usage on schema public to anon, authenticated, service_role;
grant select on artists, artworks, facts to anon, authenticated;       -- RLS: approved / verified rows only
grant all on all tables in schema public to service_role;               -- backend + upload script
grant execute on function match_artworks(vector, int) to service_role;
