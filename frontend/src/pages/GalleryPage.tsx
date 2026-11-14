/** Screen 5 · Галерея (US-09, US-14). */
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api/client";
import { GENRE_LABELS, type Genre } from "../api/types";
import { useApi } from "../api/useApi";
import { ArtworkCard, AuthorCard } from "../components/cards";
import { Input } from "../components/Input";
import { ErrorMessage, Loading, Page } from "../components/Layout";
import { Tag } from "../components/Tag";

export function GalleryPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [genre, setGenre] = useState<Genre | null>(null);
  const artists = useApi(() => api.artists(), []);
  const artworks = useApi(() => api.artworks({ q, genre, limit: 50 }), [q, genre]);
  const allCount = useApi(() => api.artworks({ limit: 1 }), []);

  return (
    <Page
      title="Галерея"
      subtitle={artists.data && allCount.data ? `${artists.data.length} художників · ${allCount.data.total} картин із суспільного надбання` : " "}
      actions={
        <div className="w-[400px]">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Пошук: автор, картина або настрій" />
        </div>
      }
    >
      <section>
        <div className="mb-6 flex items-center justify-between">
          <h2 className="t-h2">Автори</h2>
          <Link to="/artists" className="t-strong text-accent">Усі автори →</Link>
        </div>
        {artists.loading ? (
          <Loading />
        ) : artists.error ? (
          <ErrorMessage error={artists.error} onRetry={artists.reload} />
        ) : (
          <div className="grid grid-cols-6 gap-6">
            {artists.data!.slice(0, 6).map((a) => (
              <AuthorCard key={a.id} artist={a} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-16">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="t-h2">Картини</h2>
          <div className="flex gap-2">
            <Tag active={genre === null} onClick={() => setGenre(null)}>Усі</Tag>
            {(Object.keys(GENRE_LABELS) as Genre[]).map((g) => (
              <Tag key={g} active={genre === g} onClick={() => setGenre(g)}>{GENRE_LABELS[g]}</Tag>
            ))}
          </div>
        </div>
        {artworks.loading ? (
          <Loading />
        ) : artworks.error ? (
          <ErrorMessage error={artworks.error} onRetry={artworks.reload} />
        ) : (
          <div className="grid grid-cols-5 gap-6">
            {artworks.data!.items.map((a) => (
              // TODO(team): no artwork detail screen is designed — for now a click opens the picker (2b) preselected
              <ArtworkCard key={a.id} artwork={a} onClick={() => navigate(`/create/painting?artwork=${a.id}`)} />
            ))}
          </div>
        )}
        <p className="t-small mt-8 text-text-secondary">Натисніть на картину, щоб прочитати її історію або зробити з неї мем.</p>
      </section>
    </Page>
  );
}
