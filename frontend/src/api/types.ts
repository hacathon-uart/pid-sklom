// Mirror of backend/app/schemas.py — change both in the same PR. Full reference: docs/API.md

export type Position = "top" | "middle" | "bottom";
export type Genre = "portrait" | "landscape" | "everyday" | "avantgarde";
export type CaptionKind = "everyday" | "work" | "story";
export type Source = "ai" | "embeddings" | "fallback"; // ai = hybrid LLM, embeddings = vector search, fallback = word matching

export const GENRE_LABELS: Record<Genre, string> = {
  portrait: "Портрет",
  landscape: "Пейзаж",
  everyday: "Побут",
  avantgarde: "Авангард",
};

export const CAPTION_KIND_LABELS: Record<CaptionKind, string> = {
  everyday: "Щодня",
  work: "Робота",
  story: "З історії картини",
};

export interface Fact {
  id: number;
  text: string;
  source_url: string | null;
}

export interface ArtistRef {
  id: number;
  slug: string;
  name: string;
  birth_year: number | null;
  death_year: number | null;
  portrait_url: string | null;
}

export interface ArtistSummary extends ArtistRef {
  short_bio: string;
}

export interface ArtworkSummary {
  id: number;
  slug: string;
  title: string;
  year: number | null;
  genre: Genre | null;
  image_url: string;
  thumb_url: string;
  artist: ArtistRef;
}

export interface Story {
  museum: string | null;
  about_artwork: string;
  artwork_fact: Fact | null;
  artist_fact: Fact | null;
  source_url: string | null;
}

export interface ArtworkDetail extends ArtworkSummary {
  museum: string | null;
  medium: string | null;
  about: string;
  license: string | null;
  source_url: string | null;
  tags: string[];
  facts: Fact[];
  artist_facts: Fact[];
  story: Story;
}

export interface ArtistDetail extends ArtistSummary {
  birth_place: string | null;
  long_bio: string;
  sources: string[];
  facts: Fact[];
  featured_artwork: ArtworkSummary | null;
  artworks: ArtworkSummary[];
}

export interface ArtworkPage {
  items: ArtworkSummary[];
  total: number;
}

export interface MatchCandidate {
  artwork: ArtworkSummary;
  score: number | null;
}

export interface MatchResult {
  artwork: ArtworkSummary;
  story: Story;
  caption: string;
  position: Position;
  reason: string;
  alternatives: MatchCandidate[];
  source: Source;
}

export interface CaptionOption {
  text: string;
  kind: CaptionKind;
}

export interface CaptionsResult {
  artwork_id: number;
  captions: CaptionOption[];
  source: Source;
}

/** Coordinates are relative to the image (0..1); size is px at REFERENCE_WIDTH. */
export interface TextBlock {
  text: string;
  font: string;
  size: number;
  color: string;
  outline: boolean;
  position: Position;
  x: number | null;
  y: number | null;
  width: number | null;
}

/** Picture frame around a meme (MemeStyle.frame). The stored PNG is frameless. */
export type Frame = "gold" | "gallery" | "oak" | "mat";

export const FRAME_LABELS: Record<Frame, string> = {
  gold: "Золота",
  gallery: "Галерейна",
  oak: "Дубова",
  mat: "Паспарту",
};

export interface MemeStyle {
  blocks: TextBlock[];
  frame?: Frame; // older memes have none → "gold"
}

export interface Meme {
  id: string;
  artwork: ArtworkSummary;
  caption: string;
  style: MemeStyle;
  image_url: string | null;
  is_favorite: boolean;
  created_at: string;
  can_edit: boolean;
}

// ---------- Quizzes (ADR 0008) ----------

export type QuizGame = "who" | "pairs" | "titles";
export type QuizEnd = "mistake" | "complete" | "guest_limit";

export interface QuizScope {
  key: string; // "all" or an artist slug
  name: string;
  artworks: number;
}

export interface QuizInfo {
  games: QuizGame[];
  title_scopes: QuizScope[];
  limited: boolean;
  guest_limits: Record<QuizGame, number>;
  best: Record<string, number> | null; // "who" | "pairs" | "titles:<scope>"
}

export interface QuizQuestion {
  images: { key: string; image_url: string }[];
  options: { key: string; label: string }[];
}

export interface QuizRun {
  token: string | null;
  score: number;
  limit: number | null;
  question: QuizQuestion | null;
}

export interface QuizReveal {
  image_key: string;
  correct: boolean;
  chosen: string | null;
  right: string;
  artwork: ArtworkSummary;
  fact: string;
}

export interface QuizResult {
  correct: boolean;
  reveals: QuizReveal[];
  run: QuizRun;
  finished: QuizEnd | null;
  best: number | null;
  new_record: boolean;
}
