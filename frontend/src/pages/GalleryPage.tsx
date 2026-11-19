/** Screen 5 · Галерея (US-09, US-14). */
import { plural } from "../plural";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api/client";
import { GENRE_LABELS, type Genre } from "../api/types";
import { useApi } from "../api/useApi";
import { useArtworkCatalogue } from "../api/useArtworkCatalogue";
import { ArtworkPagination } from "../components/ArtworkPagination";
import { ArtworkCard, AuthorCard } from "../components/cards";
import { SearchInput } from "../components/Input";
import { Icon } from "../components/Icon";
import { ErrorMessage, Loading, Page } from "../components/Layout";
import { HallTitle, RopedOff, VelvetRope, Wall } from "../components/Museum";
import { Tag } from "../components/Tag";

export function GalleryPage() {
  const navigate = useNavigate();
  const { query: q, genre, page, result: artworks, setQuery: setQ, setGenre, setPage } = useArtworkCatalogue();
  const artists = useApi(() => api.artists(), []);
  const allCount = useApi(() => api.artworks({ limit: 1 }), []);
  const changePage = (next: number) => {
    setPage(next);
    document.getElementById("gallery-artworks")?.focus();
  };

  // Match the visible columns: preserve the desktop three-author carousel step.
  const [authorStart, setAuthorStart] = useState(0);
  const [slide, setSlide] = useState<"next" | "prev">("next");
  const authorList = artists.data ?? [];
  const PER_VIEW = 6;
  const canScroll = authorList.length > 2;
  const scrollAuthors = (dir: 1 | -1) => {
    const step = window.innerWidth >= 1024 ? 3 : window.innerWidth >= 768 ? 2 : 1;
    setSlide(dir === 1 ? "next" : "prev");
    setAuthorStart((s) => (s + dir * step + authorList.length) % authorList.length);
  };
  const visibleAuthors = canScroll
    ? Array.from({ length: Math.min(PER_VIEW, authorList.length) }, (_, i) => authorList[(authorStart + i) % authorList.length])
    : authorList;

  return (
    <Page
      title="Галерея"
      subtitle={artists.data && allCount.data ? `${artists.data.length} ${plural(artists.data.length, "художник", "художники", "художників")} · ${allCount.data.total} ${plural(allCount.data.total, "картина", "картини", "картин")} із суспільного надбання` : " "}
      actions={
        <div className="w-full min-w-0 md:w-80 xl:w-[400px]">
          <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Автор, картина або настрій" />
        </div>
      }
    >
      <section>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4 md:mb-8">
          <HallTitle n={1}>Автори</HallTitle>
          <Link to="/artists" className="t-strong inline-flex min-h-11 items-center text-accent">Усі автори →</Link>
        </div>
        {artists.loading ? (
          <Loading />
        ) : artists.error ? (
          <ErrorMessage error={artists.error} onRetry={artists.reload} />
        ) : (
          <div className="relative">
            {/* Controls stay inside the content area on phones. */}
            {canScroll && (
              <div className={`mb-4 flex justify-between gap-4 lg:mb-0 ${authorList.length <= PER_VIEW ? "lg:hidden" : ""}`}>
                <CarouselArrow dir="prev" onClick={() => scrollAuthors(-1)} />
                <CarouselArrow dir="next" onClick={() => scrollAuthors(1)} />
              </div>
            )}
            <div key={authorStart} className={`grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-6 lg:grid-cols-6 ${canScroll ? (slide === "next" ? "slide-next" : "slide-prev") : ""}`}>
              {visibleAuthors.map((a, i) => (
                <div key={a.id} className={i >= 3 ? "hidden lg:block" : i >= 2 ? "hidden md:block" : "min-w-0"}>
                  <AuthorCard artist={a} />
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Each genre is its own hall with its own wall colour (W6). */}
      <Wall genre={genre} className="max-md:py-8 -mb-8 mt-10 pb-12 md:-mb-12 md:mt-16 md:pb-20">
        <div className="mb-6 flex flex-col items-start gap-6 lg:mb-10 lg:flex-row lg:items-end lg:justify-between">
          <HallTitle n={2}>Картини</HallTitle>
          <div className="flex flex-wrap gap-2">
            <Tag className="min-h-11" active={genre === null} onClick={() => setGenre(null)}>Усі</Tag>
            {(Object.keys(GENRE_LABELS) as Genre[]).map((g) => (
              <Tag key={g} className="min-h-11" active={genre === g} onClick={() => setGenre(g)}>{GENRE_LABELS[g]}</Tag>
            ))}
          </div>
        </div>
        <div id="gallery-artworks" role="region" tabIndex={-1} aria-label="Картини галереї" className="scroll-mt-6 focus:outline-none">
        {artworks.loading ? (
          <Loading />
        ) : artworks.error ? (
          <ErrorMessage error={artworks.error} onRetry={artworks.reload} />
        ) : artworks.data!.items.length === 0 ? (
          <RopedOff>У цьому залі такої картини немає. Спробуйте інше слово або інший жанр.</RopedOff>
        ) : (
          <div className="grid grid-cols-1 gap-x-4 gap-y-8 min-[375px]:grid-cols-2 md:grid-cols-3 md:gap-x-6 md:gap-y-10 xl:grid-cols-5">
            {artworks.data!.items.map((a) => (
              // TODO(team): no artwork detail screen is designed — for now a click opens the picker (2b) preselected
              <ArtworkCard key={a.id} artwork={a} onClick={() => navigate(`/create/painting?artwork=${a.id}`)} />
            ))}
          </div>
        )}
        {!artworks.loading && !artworks.error && artworks.data && (
          <ArtworkPagination page={page} total={artworks.data.total} onPageChange={changePage} />
        )}
        </div>
        {/* The empty state already shows a rope, so the closing one only follows real results. */}
        {artworks.data && artworks.data.items.length > 0 && (
          <div className="mt-12 flex flex-col items-center gap-2">
            <VelvetRope />
          </div>
        )}
      </Wall>
    </Page>
  );
}

/** Labelled phone controls become margin arrows beside desktop portraits. */
function CarouselArrow({ dir, onClick }: { dir: "prev" | "next"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={dir === "prev" ? "Попередні автори" : "Наступні автори"}
      className={`flex min-h-11 min-w-11 items-center gap-2 p-2 lg:absolute lg:top-[62px] lg:z-10 lg:-translate-y-1/2 text-accent-soft transition-colors hover:text-accent focus-visible:text-accent ${dir === "prev" ? "lg:-left-6 xl:-left-12" : "lg:-right-6 xl:-right-12"}`}
    >
      <Icon name={dir === "prev" ? "arrowLeft" : "arrowRight"} size={24} />
      <span className="t-small lg:hidden">{dir === "prev" ? "Попередні" : "Наступні"}</span>
    </button>
  );
}
