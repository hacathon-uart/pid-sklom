import { Link } from "react-router";
import type { ArtistSummary, ArtworkSummary, Meme } from "../api/types";
import { Artwork } from "./Artwork";
import { Icon } from "./Icon";
import { inventoryNo, WallLabel } from "./Museum";
import { Portrait } from "./Portrait";

export const years = (a: { birth_year: number | null; death_year: number | null }) =>
  `${a.birth_year ?? "?"}–${a.death_year ?? "?"}`;

export function ArtworkCard({
  artwork,
  selected,
  meta,
  onClick,
  onZoom,
}: {
  artwork: ArtworkSummary;
  selected?: boolean;
  meta?: string; // bottom line of the label; default «Інв. № ПС-0042», Top-5 uses «Збіг 95%»
  onClick?: () => void;
  onZoom?: () => void; // shows a loupe button over the picture that opens it full-screen
}) {
  const card = (
    // self-start: a button centres its content vertically, so in a grid row the cards with a short
    // label were pushed down relative to the ones with a two-line title.
    <button onClick={onClick} className="block w-full min-w-0 self-start text-left [overflow-wrap:anywhere]">
      <Artwork src={artwork.thumb_url} alt={artwork.title} selected={selected} aspect="4/5" size="sm" />
      <WallLabel
        className={`mt-3 max-md:[&_.wl-who]:whitespace-normal md:mt-4 ${selected ? "ring-2 ring-accent" : ""}`}
        who={artwork.artist.name}
        what={`${artwork.title}${artwork.year ? `, ${artwork.year}` : ""}`}
        inv={meta ?? `Інв. № ${inventoryNo(artwork.id)}`}
        invRight
      />
    </button>
  );
  if (!onZoom) return card;
  return (
    <div className="relative min-w-0 self-start">
      {card}
      <ZoomButton label={`Збільшити «${artwork.title}»`} onClick={onZoom} className="absolute top-3 right-3" />
    </div>
  );
}

/** Round loupe button laid over a thumbnail. */
export function ZoomButton({ label, onClick, className = "" }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title="Збільшити"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className={`flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white shadow transition hover:scale-105 hover:bg-black/75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${className}`}
    >
      <Icon name="zoom" size={20} />
    </button>
  );
}

export function AuthorCard({ artist }: { artist: ArtistSummary }) {
  return (
    <Link to={`/artists/${artist.slug}`} className="flex min-w-0 flex-col items-center text-center [overflow-wrap:anywhere]">
      <Portrait src={artist.portrait_url} name={artist.name} size={124} className="max-md:h-24 max-md:w-20" />
      <div className="t-strong mt-4">{artist.name}</div>
      <div className="t-small mt-1 text-text-secondary">{years(artist)}</div>
    </Link>
  );
}

/** Saved meme in «Мої меми». Favourites (♥) are marked with cracked glass, the collection's best pieces. */
export function MemeCard({ meme }: { meme: Meme }) {
  const date = new Date(meme.created_at).toLocaleDateString("uk-UA", { day: "numeric", month: "numeric", year: "numeric" });
  return (
    <Link to={`/me/memes/${meme.id}`} className="block min-w-0 [overflow-wrap:anywhere]">
      <Artwork
        src={meme.image_url ?? meme.artwork.thumb_url}
        alt={meme.caption}
        aspect="1/1"
        size="sm"
        frame={meme.style.frame ?? "gold"}
        crack={meme.is_favorite ? "static" : null}
      />
      <WallLabel
        className="mt-3 max-md:[&_.wl-who]:whitespace-normal md:mt-4"
        who={meme.artwork.artist.name}
        what={meme.artwork.title}
        inv={date}
        invRight
      />
    </Link>
  );
}
