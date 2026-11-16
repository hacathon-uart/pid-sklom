/** Screen 5 · Галерея (US-09, US-14). */
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api/client";
import { GENRE_LABELS, type Genre } from "../api/types";
import { useApi } from "../api/useApi";
import { ArtworkCard, AuthorCard } from "../components/cards";
import { SearchInput } from "../components/Input";
import { Icon } from "../components/Icon";
import { ErrorMessage, Loading, Page } from "../components/Layout";
import { HallTitle, RopedOff, VelvetRope, Wall } from "../components/Museum";
import { Tag } from "../components/Tag";

export function GalleryPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [genre, setGenre] = useState<Genre | null>(null);
  const artists = useApi(() => api.artists(), []);
  const artworks = useApi(() => api.artworks({ q, genre, limit: 50 }), [q, genre]);
  const allCount = useApi(() => api.artworks({ limit: 1 }), []);

  // Author carousel: shows 6 at a time and wraps around, so scrolling never hits an end.
  const [authorStart, setAuthorStart] = useState(0);
  const [slide, setSlide] = useState<"next" | "prev">("next");
  const authorList = artists.data ?? [];
  const PER_VIEW = 6;
  const STEP = 3;
  const canScroll = authorList.length > PER_VIEW;
  const scrollAuthors = (dir: 1 | -1) => {
    setSlide(dir === 1 ? "next" : "prev");
    setAuthorStart((s) => (s + dir * STEP + authorList.length) % authorList.length);
  };
  const visibleAuthors = canScroll
    ? Array.from({ length: PER_VIEW }, (_, i) => authorList[(authorStart + i) % authorList.length])
    : authorList;

  return (
    <Page
      title="Галерея"
      subtitle={artists.data && allCount.data ? `${artists.data.length} художників · ${allCount.data.total} картин із суспільного надбання` : " "}
      actions={
        <div className="w-[400px]">
          <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Автор, картина або настрій" />
        </div>
      }
    >
      <section>
        <div className="mb-8 flex items-end justify-between">
          <HallTitle n={1}>Автори</HallTitle>
          <Link to="/artists" className="t-strong text-accent">Усі автори →</Link>
        </div>
        {artists.loading ? (
          <Loading />
        ) : artists.error ? (
          <ErrorMessage error={artists.error} onRetry={artists.reload} />
        ) : (
          <div className="relative">
            {/* Plain arrows in the page margins, level with the portraits */}
            {canScroll && (
              <>
                <CarouselArrow dir="prev" onClick={() => scrollAuthors(-1)} />
                <CarouselArrow dir="next" onClick={() => scrollAuthors(1)} />
              </>
            )}
            <div key={authorStart} className={`grid grid-cols-6 gap-6 ${canScroll ? (slide === "next" ? "slide-next" : "slide-prev") : ""}`}>
              {visibleAuthors.map((a) => (
                <AuthorCard key={a.id} artist={a} />
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Each genre is its own hall with its own wall colour (W6). */}
      <Wall genre={genre} className="-mb-12 mt-16 pb-20">
        <div className="mb-10 flex items-end justify-between">
          <HallTitle n={2}>Картини</HallTitle>
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
        ) : artworks.data!.items.length === 0 ? (
          <RopedOff>У цьому залі такої картини немає. Спробуйте інше слово або інший жанр.</RopedOff>
        ) : (
          <div className="grid grid-cols-5 gap-x-6 gap-y-10">
            {artworks.data!.items.map((a) => (
              // TODO(team): no artwork detail screen is designed — for now a click opens the picker (2b) preselected
              <ArtworkCard key={a.id} artwork={a} onClick={() => navigate(`/create/painting?artwork=${a.id}`)} />
            ))}
          </div>
        )}
        <div className="mt-12 flex flex-col items-center gap-2">
          <VelvetRope />
        </div>
      </Wall>
    </Page>
  );
}

/** Bare arrow: light brown at rest, darker on hover. Sits in the left/right margin (the page has 64 px side padding). */
function CarouselArrow({ dir, onClick }: { dir: "prev" | "next"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={dir === "prev" ? "Попередні автори" : "Наступні автори"}
      className={`absolute top-[62px] z-10 -translate-y-1/2 p-2 text-accent-soft transition-colors hover:text-accent focus-visible:text-accent ${dir === "prev" ? "-left-12" : "-right-12"}`}
    >
      <Icon name={dir === "prev" ? "arrowLeft" : "arrowRight"} size={30} />
    </button>
  );
}
