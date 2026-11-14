import { Link } from "react-router";
import type { ArtworkSummary, Story } from "../api/types";
import { years } from "./cards";
import { Icon } from "./Icon";
import { Portrait } from "./Portrait";

/** «Історія за мемом» — the most valuable block on every result screen. Facts come only from the DB. */
export function StoryCard({ artwork, story }: { artwork: ArtworkSummary; story: Story }) {
  const { artist } = artwork;
  return (
    <section className="rounded-story border border-line bg-surface p-8">
      <div className="t-label">Історія за мемом</div>
      <header className="mt-6 flex items-center gap-5 border-b border-line pb-6">
        <Portrait src={artist.portrait_url} name={artist.name} />
        <div>
          <h2 className="t-h2">
            «{artwork.title}»{artwork.year ? `, ${artwork.year}` : ""}
          </h2>
          <div className="t-body mt-1 text-text-secondary">
            {artist.name} · {years(artist)}
            {story.museum ? ` · ${story.museum}` : ""}
          </div>
        </div>
      </header>

      {story.about_artwork && (
        <>
          <h3 className="t-strong mt-6">Про картину</h3>
          <p className="t-body-lg mt-2">{story.about_artwork}</p>
        </>
      )}

      {story.artwork_fact && (
        <div className="mt-6 rounded-card bg-muted p-6">
          <div className="t-label">Несподіваний факт</div>
          <p className="t-quote mt-2">«{story.artwork_fact.text}»</p>
        </div>
      )}

      {story.artist_fact && (
        <>
          <h3 className="t-strong mt-6">Про автора</h3>
          <p className="t-body mt-2">{story.artist_fact.text}</p>
        </>
      )}

      <footer className="mt-6 flex items-center justify-between gap-4">
        <Link to={`/artists/${artist.slug}`} className="t-strong flex items-center gap-2 text-accent">
          Більше про автора <Icon name="arrowRight" size={18} />
        </Link>
        {story.source_url && (
          <a href={story.source_url} target="_blank" rel="noreferrer" className="t-caption text-text-secondary">
            Джерело
          </a>
        )}
      </footer>
    </section>
  );
}
