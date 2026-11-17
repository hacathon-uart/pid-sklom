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
  sources      text[] not null default '{}'
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
  embedding_model   text                        -- which model produced `embedding`
);
create index if not exists artworks_artist on artworks (artist_id);

create table if not exists facts (
  id         bigint primary key,
  artist_id  bigint references artists(id),
  artwork_id bigint references artworks(id),
  text_uk    text not null,
  source_url text,
  verified   boolean not null default false,
  check ((artist_id is null) <> (artwork_id is null))
);

create table if not exists memes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  artwork_id  bigint not null references artworks(id),
  caption     text not null,
  style       jsonb not null,                   -- MemeStyle (backend/app/schemas.py)
  image_url   text,
  is_favorite boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists memes_user_created on memes (user_id, created_at desc);

-- The backend uses the service key and does its own checks, so RLS mainly protects
-- against the public anon key. Content is read-only for everyone; memes are private.
alter table artists  enable row level security;
alter table artworks enable row level security;
alter table facts    enable row level security;
alter table memes    enable row level security;
create policy "public read" on artists  for select using (true);
create policy "public read" on artworks for select using (review_status = 'approved');
create policy "public read" on facts    for select using (verified);

-- Storage: create public buckets «artworks» (images + thumbs) and «memes» (saved PNGs).
