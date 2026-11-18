/** Screen 5b · Сторінка автора (US-10). */
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api/client";
import { useApi } from "../api/useApi";
import { Artwork } from "../components/Artwork";
import { Button } from "../components/Button";
import { years } from "../components/cards";
import { Icon } from "../components/Icon";
import { ErrorMessage, Loading, Page } from "../components/Layout";
import { Portrait } from "../components/Portrait";

export function ArtistPage() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const { data: artist, error, loading, reload } = useApi(() => api.artist(slug), [slug]);
  const featuredId = artist?.featured_artwork?.id;
  const featured = useApi(() => (featuredId ? api.artwork(featuredId) : Promise.resolve(null)), [featuredId]);

  const back = (
    <Link to="/gallery" className="t-strong flex items-center gap-2 text-accent">
      <Icon name="arrowLeft" size={18} /> Галерея
    </Link>
  );
  if (loading) return <Page title="" back={back}><Loading /></Page>;
  if (error || !artist) return <Page title="Автор" back={back}><ErrorMessage error={error ?? "Помилка"} onRetry={reload} /></Page>;

  const f = featured.data;
  return (
    <Page title={artist.name} back={back}>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-12">
        <div className="min-w-0 break-words">
          <header className="flex flex-col items-start gap-4 min-[430px]:flex-row min-[430px]:items-center md:gap-7">
            <Portrait src={artist.portrait_url} name={artist.name} size={146} className="max-md:w-20 max-md:h-24" />
            <div>
              <div className="t-label">Автор</div>
              <div className="t-body mt-2 text-text-secondary">
                {years(artist)}
                {artist.birth_place ? ` · ${artist.birth_place}` : ""}
              </div>
            </div>
          </header>
          <p className="t-body-lg mt-8 whitespace-pre-line">{artist.long_bio}</p>

          {artist.facts.length > 0 && (
            <section className="mt-8 rounded-card border border-line bg-surface p-4 md:p-6">
              <div className="t-label mb-3">Несподівані факти</div>
              <ul className="list-disc space-y-2 pl-5 marker:text-accent">
                {artist.facts.map((fact) => (
                  <li key={fact.id} className="t-body">{fact.text}</li>
                ))}
              </ul>
            </section>
          )}

          {artist.featured_artwork && (
            <section className="mt-8">
              <Artwork src={artist.featured_artwork.image_url} alt={artist.featured_artwork.title} />
              <div className="mt-4 flex flex-col items-start gap-4 xl:flex-row xl:justify-between">
                <div>
                  <div className="t-h3">«{artist.featured_artwork.title}»{artist.featured_artwork.year ? `, ${artist.featured_artwork.year}` : ""}</div>
                  <div className="t-small text-text-secondary">{[f?.museum, f?.medium].filter(Boolean).join(" · ")}</div>
                </div>
                <Button className="min-h-11 w-full whitespace-normal xl:w-auto xl:shrink-0" onClick={() => navigate(`/create/painting/${artist.featured_artwork!.id}/ai`)}>Зробити мем з картини</Button>
              </div>
            </section>
          )}
        </div>

        <aside className="min-w-0 lg:border-l lg:border-line lg:pl-10">
          <div className="t-label mb-4">Картини автора</div>
          <div className="grid grid-cols-1 gap-4 min-[375px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-2">
            {artist.artworks.map((w) => (
              <Link key={w.id} to={`/create/painting?artwork=${w.id}`} title={w.title} className="min-w-0 break-words">
                <Artwork src={w.thumb_url} alt={w.title} aspect="4/5" size="sm" />
                <span className="t-small mt-2 block">{w.title}</span>
              </Link>
            ))}
          </div>
        </aside>
      </div>
    </Page>
  );
}
