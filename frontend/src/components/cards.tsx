import { Link } from "react-router";
import type { ArtistSummary, ArtworkSummary, Meme } from "../api/types";
import { Artwork } from "./Artwork";
import { Portrait } from "./Portrait";

export const years = (a: { birth_year: number | null; death_year: number | null }) =>
  `${a.birth_year ?? "?"}–${a.death_year ?? "?"}`;

export function ArtworkCard({
  artwork,
  selected,
  meta,
  onClick,
}: {
  artwork: ArtworkSummary;
  selected?: boolean;
  meta?: string; // default «Автор · рік»; Top-5 uses «Автор · збіг 95%»
  onClick?: () => void;
}) {
  return (
    <button onClick={onClick} className="block w-full text-left">
      <Artwork src={artwork.thumb_url} alt={artwork.title} selected={selected} aspect="4/5" />
      <div className={`t-strong mt-3 truncate ${selected ? "text-accent" : ""}`}>{artwork.title}</div>
      <div className="t-small mt-1 text-text-secondary">
        {meta ?? `${artwork.artist.name}${artwork.year ? ` · ${artwork.year}` : ""}`}
      </div>
    </button>
  );
}

export function AuthorCard({ artist }: { artist: ArtistSummary }) {
  return (
    <Link to={`/artists/${artist.slug}`} className="flex flex-col items-center text-center">
      <Portrait src={artist.portrait_url} name={artist.name} size={124} />
      <div className="t-strong mt-4">{artist.name}</div>
      <div className="t-small mt-1 text-text-secondary">{years(artist)}</div>
    </Link>
  );
}

export function MemeCard({ meme }: { meme: Meme }) {
  const date = new Date(meme.created_at).toLocaleDateString("uk-UA", { day: "numeric", month: "numeric" });
  return (
    <Link to={`/me/memes/${meme.id}`} className="block">
      <Artwork src={meme.image_url ?? meme.artwork.thumb_url} alt={meme.caption} aspect="1/1" />
      <div className="t-small mt-3 text-text-secondary">
        {meme.artwork.artist.name} · збережено {date}
      </div>
    </Link>
  );
}
