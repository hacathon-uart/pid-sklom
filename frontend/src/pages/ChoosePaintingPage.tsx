/** Screen 2b · Картина → підпис — вибір картини (US-02). URL: ?artwork=<id> preselects; ?mode=own|ai picks the main button. */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { api } from "../api/client";
import { GENRE_LABELS, type ArtworkSummary, type Genre } from "../api/types";
import { useArtworkCatalogue } from "../api/useArtworkCatalogue";
import { ArtworkPagination } from "../components/ArtworkPagination";
import { Button } from "../components/Button";
import { ArtworkCard } from "../components/cards";
import { SearchInput } from "../components/Input";
import { ErrorMessage, Loading, Page } from "../components/Layout";
import { ModeSwitch } from "../components/ModeSwitch";
import { VelvetRope } from "../components/Museum";
import { PaintingViewer } from "../components/PaintingViewer";
import { Tag } from "../components/Tag";

export function ChoosePaintingPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { query: q, genre, page, result: catalogue, setQuery: setQ, setGenre, setPage } = useArtworkCatalogue();
  const [selected, setSelected] = useState<ArtworkSummary | null>(null);
  const [zoomed, setZoomed] = useState<ArtworkSummary | null>(null);
  const [randomBusy, setRandomBusy] = useState(false);
  const [randomError, setRandomError] = useState<string | null>(null);
  const [preselection, setPreselection] = useState<"loading" | "error" | null>(null);
  const [preselectionAttempt, setPreselectionAttempt] = useState(0);
  const [panelHeight, setPanelHeight] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const selectionEpoch = useRef(0);
  const ownFirst = params.get("mode") === "own";
  const preselectedId = params.get("artwork");
  const { data, error, loading, reload } = catalogue;
  const changePage = (next: number) => {
    setPage(next);
    document.getElementById("picker-artworks")?.focus();
  };

  useEffect(() => {
    const epoch = ++selectionEpoch.current;
    setRandomBusy(false);
    setRandomError(null);
    setPreselection(null);
    if (preselectedId === null) return;
    const id = Number(preselectedId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      setPreselection("error");
      return;
    }
    setPreselection("loading");
    api.artwork(id).then((artwork) => {
      if (epoch !== selectionEpoch.current) return;
      setSelected(artwork);
      setPreselection(null);
    }).catch(() => {
      if (epoch === selectionEpoch.current) setPreselection("error");
    });
    return () => { selectionEpoch.current += 1; };
  }, [preselectedId, preselectionAttempt]);

  useLayoutEffect(() => {
    if (!selected || !panelRef.current) return;
    const panel = panelRef.current;
    const root = document.documentElement;
    const previousClearance = root.style.getPropertyValue("--picker-panel-clearance");
    const measure = () => {
      const height = panel.getBoundingClientRect().height;
      setPanelHeight(height);
      root.style.setProperty("--picker-panel-clearance", `${height}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => {
      observer.disconnect();
      if (previousClearance) root.style.setProperty("--picker-panel-clearance", previousClearance);
      else root.style.removeProperty("--picker-panel-clearance");
    };
  }, [selected]);

  const choose = (artwork: ArtworkSummary | null) => {
    selectionEpoch.current += 1;
    setRandomBusy(false);
    setRandomError(null);
    setPreselection(null);
    setSelected(artwork);
  };
  const random = async () => {
    const epoch = ++selectionEpoch.current;
    setRandomBusy(true);
    setRandomError(null);
    setPreselection(null);
    try {
      const artwork = await api.randomArtwork();
      if (epoch === selectionEpoch.current) setSelected(artwork);
    } catch {
      if (epoch === selectionEpoch.current) setRandomError("Не вдалося обрати картину. Спробуйте ще раз.");
    } finally {
      if (epoch === selectionEpoch.current) setRandomBusy(false);
    }
  };

  return (
    <Page title="Створити мем" subtitle="Оберіть картину, а підпис запропонує ШІ або напишете ви самі" actions={<ModeSwitch />}>
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Автор, назва або настрій" className="w-full lg:max-w-[370px]" />
        <div className="flex min-w-0 flex-wrap gap-2">
          <Tag active={genre === null} onClick={() => setGenre(null)}>Усі</Tag>
          {(Object.keys(GENRE_LABELS) as Genre[]).map((g) => (
            <Tag key={g} active={genre === g} onClick={() => setGenre(g)}>{GENRE_LABELS[g]}</Tag>
          ))}
        </div>
        <Button variant="secondary" className="w-full sm:ml-auto sm:w-auto" onClick={() => void random()} disabled={randomBusy}>{randomBusy ? "Обираємо…" : "Випадкова картина"}</Button>
      </div>
      {randomError && <div className="mb-6"><ErrorMessage error={randomError} onRetry={() => void random()} /></div>}
      {preselection && (
        <div aria-busy={preselection === "loading"} className="mb-6 rounded-card border border-line bg-surface p-5">
          <p role={preselection === "error" ? "alert" : "status"} className="t-body text-text-secondary">
            {preselection === "loading" ? "Завантажуємо обрану картину…" : "Не вдалося завантажити картину за посиланням. Спробуйте ще раз або оберіть іншу в каталозі."}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            {preselection === "error" && <Button variant="secondary" onClick={() => {
              selectionEpoch.current += 1;
              setPreselectionAttempt((attempt) => attempt + 1);
            }}>Спробувати ще раз</Button>}
            <Button variant="soft" onClick={() => {
              selectionEpoch.current += 1;
              setPreselection(null);
            }}>Закрити повідомлення</Button>
          </div>
        </div>
      )}

      <div id="picker-artworks" role="region" tabIndex={-1} aria-label="Картини для вибору" className="scroll-mt-6 focus:outline-none">
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorMessage error={error} onRetry={reload} />
      ) : data!.items.length === 0 ? (
        <p className="t-body text-text-secondary">Нічого не знайшли. Спробуйте інше слово.</p>
      ) : (
        <div className="grid grid-cols-1 gap-5 min-[360px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 xl:gap-6">
          {data!.items.map((a) => (
            <ArtworkCard key={a.id} artwork={a} selected={selected?.id === a.id} onClick={() => choose(a)} onZoom={() => setZoomed(a)} />
          ))}
        </div>
      )}
      {!loading && !error && data && <ArtworkPagination page={page} total={data.total} onPageChange={changePage} />}
      </div>

      <div className="mt-16 flex justify-center">
        <VelvetRope />
      </div>
      {selected && <div aria-hidden style={{ height: panelHeight + 24 }} />}

      {selected && (
        <div className="fixed right-0 bottom-[calc(var(--app-bottom-clearance)+8px)] left-[var(--app-side-offset)] z-20 px-[var(--page-gutter)] md:bottom-6">
          <div ref={panelRef} className="mx-auto max-h-[min(55dvh,360px)] max-w-[1150px] overflow-y-auto rounded-story border border-accent bg-surface p-4 shadow-lg lg:flex lg:items-center lg:gap-5">
            <div className="flex min-w-0 items-center gap-3 md:gap-5 lg:flex-1">
              <button type="button" aria-label={`Збільшити «${selected.title}»`} title="Збільшити" onClick={() => setZoomed(selected)} className="shrink-0 cursor-zoom-in rounded-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                <img src={selected.thumb_url} alt="" crossOrigin="anonymous" className="h-16 w-14 rounded-control object-cover md:h-24 md:w-20" />
              </button>
              <div className="min-w-0 flex-1" role="status">
                <div className="t-label">Обрано</div>
                <div className="t-strong break-words">{selected.title}{selected.year ? `, ${selected.year}` : ""}</div>
                <div className="t-small text-text-secondary">{selected.artist.name}</div>
              </div>
              <button type="button" className="t-small min-h-11 shrink-0 rounded-control px-2 text-accent focus-visible:outline-2 focus-visible:outline-accent lg:hidden" onClick={() => choose(null)}>Закрити</button>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 md:mt-0 md:flex md:justify-end md:gap-3 lg:shrink-0">
              <Button variant="soft" className="hidden lg:inline-flex" onClick={() => choose(null)}>Скинути вибір</Button>
              <Button variant={ownFirst ? "primary" : "secondary"} onClick={() => navigate(`/create/painting/${selected.id}/own`)}>Написати свій підпис</Button>
              <Button variant={ownFirst ? "secondary" : "primary"} onClick={() => navigate(`/create/painting/${selected.id}/ai`)}>Згенерувати підпис</Button>
            </div>
          </div>
        </div>
      )}

      {zoomed && (() => {
        const items = data?.items ?? [];
        const i = items.findIndex((a) => a.id === zoomed.id);
        return (
          <PaintingViewer
            artwork={zoomed}
            onClose={() => setZoomed(null)}
            onPrev={i > 0 ? () => setZoomed(items[i - 1]) : undefined}
            onNext={i >= 0 && i < items.length - 1 ? () => setZoomed(items[i + 1]) : undefined}
            position={i >= 0 ? `${i + 1} / ${items.length}` : undefined}
          >
            {selected?.id === zoomed.id ? (
              <Button variant="secondary" className="border-white/60 text-white hover:bg-white/10" onClick={() => setZoomed(null)}>Вже обрано · Повернутися</Button>
            ) : (
              <Button onClick={() => { choose(zoomed); setZoomed(null); }}>Обрати цю картину</Button>
            )}
          </PaintingViewer>
        );
      })()}
    </Page>
  );
}
