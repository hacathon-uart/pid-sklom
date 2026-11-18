/** Screen 2b · Картина → підпис — вибір картини (US-02). URL: ?artwork=<id> preselects; ?mode=own|ai picks the main button. */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { api } from "../api/client";
import { GENRE_LABELS, type ArtworkSummary, type Genre } from "../api/types";
import { useApi } from "../api/useApi";
import { Button } from "../components/Button";
import { ArtworkCard } from "../components/cards";
import { SearchInput } from "../components/Input";
import { ErrorMessage, Loading, Page } from "../components/Layout";
import { ModeSwitch } from "../components/ModeSwitch";
import { VelvetRope } from "../components/Museum";
import { Tag } from "../components/Tag";

export function ChoosePaintingPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [q, setQ] = useState("");
  const [genre, setGenre] = useState<Genre | null>(null);
  const [selected, setSelected] = useState<ArtworkSummary | null>(null);
  const [randomBusy, setRandomBusy] = useState(false);
  const [randomError, setRandomError] = useState<string | null>(null);
  const [panelHeight, setPanelHeight] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const selectionEpoch = useRef(0);
  const ownFirst = params.get("mode") === "own";
  const preselectedId = params.get("artwork");
  // TODO(B): debounce search; pagination when the catalogue grows past ~50
  const { data, error, loading, reload } = useApi(() => api.artworks({ q, genre, limit: 50 }), [q, genre]);

  useEffect(() => {
    const id = Number(preselectedId);
    if (!id) return;
    const epoch = ++selectionEpoch.current;
    let current = true;
    api.artwork(id).then((artwork) => {
      if (current && epoch === selectionEpoch.current) setSelected(artwork);
    }).catch(() => {});
    return () => { current = false; };
  }, [preselectedId]);

  useLayoutEffect(() => {
    if (!selected || !panelRef.current) return;
    const panel = panelRef.current;
    const measure = () => setPanelHeight(panel.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [selected]);

  const choose = (artwork: ArtworkSummary | null) => {
    selectionEpoch.current += 1;
    setRandomBusy(false);
    setRandomError(null);
    setSelected(artwork);
  };
  const random = async () => {
    const epoch = ++selectionEpoch.current;
    setRandomBusy(true);
    setRandomError(null);
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

      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorMessage error={error} onRetry={reload} />
      ) : data!.items.length === 0 ? (
        <p className="t-body text-text-secondary">Нічого не знайшли. Спробуйте інше слово.</p>
      ) : (
        <div className="grid grid-cols-1 gap-5 min-[360px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 xl:gap-6">
          {data!.items.map((a) => (
            <ArtworkCard key={a.id} artwork={a} selected={selected?.id === a.id} onClick={() => choose(a)} />
          ))}
        </div>
      )}

      <div className="mt-16 flex justify-center">
        <VelvetRope />
      </div>
      {selected && <div aria-hidden style={{ height: panelHeight + 24 }} />}

      {selected && (
        <div className="fixed right-0 bottom-[calc(var(--app-bottom-clearance)+8px)] left-[var(--app-side-offset)] z-20 px-[var(--page-gutter)] md:bottom-6">
          <div ref={panelRef} className="mx-auto max-h-[min(55dvh,360px)] max-w-[1150px] overflow-y-auto rounded-story border border-accent bg-surface p-4 shadow-lg">
            <div className="flex items-center gap-3 md:gap-5">
              <img src={selected.thumb_url} alt="" className="h-16 w-14 shrink-0 rounded-control object-cover md:h-24 md:w-20" />
              <div className="min-w-0 flex-1" role="status">
                <div className="t-label">Обрано</div>
                <div className="t-strong break-words">{selected.title}{selected.year ? `, ${selected.year}` : ""}</div>
                <div className="t-small text-text-secondary">{selected.artist.name}</div>
              </div>
              <button type="button" className="t-small min-h-11 shrink-0 rounded-control px-2 text-accent focus-visible:outline-2 focus-visible:outline-accent" onClick={() => choose(null)}>Закрити</button>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 md:mt-0 md:flex md:justify-end md:gap-3">
              <Button variant={ownFirst ? "primary" : "secondary"} onClick={() => navigate(`/create/painting/${selected.id}/own`)}>Написати свій підпис</Button>
              <Button variant={ownFirst ? "secondary" : "primary"} onClick={() => navigate(`/create/painting/${selected.id}/ai`)}>Згенерувати підпис</Button>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
