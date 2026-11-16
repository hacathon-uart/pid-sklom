import { Link } from "react-router";
import type { ArtistSummary, ArtworkSummary, Meme } from "../api/types";
import { Artwork } from "./Artwork";
import { inventoryNo, WallLabel } from "./Museum";
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
  meta?: string; // bottom line of the label; default «Інв. № ПС-0042», Top-5 uses «Збіг 95%»
  onClick?: () => void;
}) {
  return (
    <button onClick={onClick} className="block w-full text-left">
      <Artwork src={artwork.thumb_url} alt={artwork.title} selected={selected} aspect="4/5" size="sm" />
      <WallLabel
        className={`mt-4 ${selected ? "ring-2 ring-accent" : ""}`}
        who={artwork.artist.name}
        what={`${artwork.title}${artwork.year ? `, ${artwork.year}` : ""}`}
        inv={meta ?? `Інв. № ${inventoryNo(artwork.id)}`}
        invRight
      />
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

/** Saved meme in «Мої меми». Favourites (♥) are marked with cracked glass, the collection's best pieces. */
export function MemeCard({ meme }: { meme: Meme }) {
  const date = new Date(meme.created_at).toLocaleDateString("uk-UA", { day: "numeric", month: "numeric", year: "numeric" });
  return (
    <Link to={`/me/memes/${meme.id}`} className="block">
      <Artwork
        src={meme.image_url ?? meme.artwork.thumb_url}
        alt={meme.caption}
        aspect="1/1"
        size="sm"
        frame={meme.style.frame ?? "gold"}
        crack={meme.is_favorite ? "static" : null}
      />
      <WallLabel
        className="mt-4"
        who={meme.artwork.artist.name}
        what={meme.artwork.title}
        inv={date}
        invRight
      />
    </Link>
  );
}
