/**
 * Screen 3 · Конструктор — результат  +  3b · Редагування підпису (US-01, US-03, US-04).
 * URL: /create/result?q=<phrase>&d=<description>
 */
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { api } from "../api/client";
import type { ArtworkSummary, Story } from "../api/types";
import { useApi } from "../api/useApi";
import { Button } from "../components/Button";
import { ArtworkCard } from "../components/cards";
import { Input } from "../components/Input";
import { PaintingViewer } from "../components/PaintingViewer";
import { ErrorMessage, Loading, Page } from "../components/Layout";
import { ModeSwitch } from "../components/ModeSwitch";
import { CaptionControls } from "../editor/CaptionControls";
import { MemeWorkspace, SaveStatus, type StoryState } from "../editor/MemeWorkspace";
import { useMemeEditor } from "../editor/useMemeEditor";
import { useTabState } from "../auth/workflow";

export function PhraseResultPage() {
  const [params] = useSearchParams();
  const phrase = params.get("q") ?? "";
  const description = params.get("d") ?? undefined;

  const { data: match, error, loading, reload } = useApi(() => (phrase ? api.match(phrase, description) : Promise.resolve(null)), [phrase, description]);
  const [selected, setSelected] = useTabState<{ artwork: ArtworkSummary; story: Story | null } | null>("selected", null);
  const [editing, setEditing] = useState(false);
  const [zoomed, setZoomed] = useState<ArtworkSummary | null>(null);
  const [storyRequest, setStoryRequest] = useState<{ artworkId: number; state: StoryState } | null>(null);
  const [storyAttempt, setStoryAttempt] = useState(0);
  const selectionEpoch = useRef(0);
  const current = selected ?? (match ? { artwork: match.artwork, story: match.story } : null);
  const { draft, stageRef, error: saveError, savedId, justSaved, save, share } =
    useMemeEditor(current?.artwork.id, { initialText: phrase });

  useEffect(() => {
    if (match) {
      if (!selected) setSelected({ artwork: match.artwork, story: match.story });
      if (!draft.restored) draft.update(0, { text: match.caption, position: match.position });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match]);

  useEffect(() => {
    const epoch = ++selectionEpoch.current;
    if (!current || current.story) return;
    const { artwork } = current;
    const retry = () => {
      selectionEpoch.current += 1;
      setStoryRequest({ artworkId: artwork.id, state: { status: "loading" } });
      setStoryAttempt((attempt) => attempt + 1);
    };
    setStoryRequest({ artworkId: artwork.id, state: { status: "loading" } });
    api.artwork(artwork.id).then((detail) => {
      if (epoch !== selectionEpoch.current) return;
      setSelected((previous) => previous?.artwork.id === artwork.id ? { artwork, story: detail.story } : previous);
      setStoryRequest({ artworkId: artwork.id, state: detail.story ? { status: "ready", story: detail.story } : { status: "unavailable" } });
    }).catch(() => {
      if (epoch !== selectionEpoch.current) return;
      setStoryRequest({ artworkId: artwork.id, state: {
        status: "error", message: "Не вдалося завантажити історію картини. Спробуйте ще раз.", retry,
      } });
    });
    return () => { selectionEpoch.current += 1; };
    // Story completion must not start another request; selection and retries own this lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.artwork.id, phrase, description, storyAttempt]);

  const pick = (artwork: ArtworkSummary) => {
    if (artwork.id === current?.artwork.id) return;
    selectionEpoch.current += 1;
    setStoryRequest({ artworkId: artwork.id, state: { status: "loading" } });
    setSelected({ artwork, story: artwork.id === match?.artwork.id ? match.story : null });
  };

  const nextAlternative = () => {
    if (!match || !current) return;
    const alts = match.alternatives;
    if (!alts.length) return;
    const i = alts.findIndex((a) => a.artwork.id === current.artwork.id);
    pick(alts[(i + 1) % alts.length].artwork);
  };

  if (!phrase) return <Page title="Ваш мем"><ErrorMessage error="Напишіть фразу на головній сторінці" /></Page>;
  if (loading) return <Page title="Ваш мем"><Loading text="Шукаємо картину…" /></Page>;
  if (error || !match || !current) return <Page title="Ваш мем"><ErrorMessage error={error ?? "Помилка"} onRetry={reload} /></Page>;

  return (
    <Page
      title={editing ? "Редагування" : "Ваш мем"}
      subtitle={editing ? "Перетягніть підпис або змініть його стиль" : "Не те? Оберіть іншу з топ-5 нижче."}
      actions={
        editing ? null : <ModeSwitch />
      }
    >
      <SaveStatus error={saveError} savedId={savedId} justSaved={justSaved} />
      <MemeWorkspace
        artwork={current.artwork}
        story={current.story ? { status: "ready", story: current.story } : storyRequest?.artworkId === current.artwork.id ? storyRequest.state : { status: "loading" }}
        draft={draft}
        editing={editing}
        onEditingChange={setEditing}
        onSave={save}
        onShare={share}
        savedId={savedId}
        stageRef={stageRef}
        onAnotherPainting={editing ? nextAlternative : undefined}
      >
        {editing ? (
          <CaptionControls draft={draft} />
        ) : (
          <>
            <div className="t-label mb-3">Підпис</div>
            <div className="flex gap-3">
              <Input aria-label="Підпис мему" value={draft.blocks[0].text} onChange={(e) => draft.setText(e.target.value)} maxLength={200} />
            </div>
            <div className="mt-4">
              <Button variant="secondary" onClick={nextAlternative}>Інша картина</Button>
            </div>
          </>
        )}
      </MemeWorkspace>

      {!editing && (
        <section className="mt-16">
          <h3 className="t-h3 mb-6">Топ-5 збігів</h3>
          <div className="grid grid-cols-1 gap-5 min-[360px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 xl:gap-6">
            {match.alternatives.map(({ artwork, score }) => (
              <ArtworkCard
                key={artwork.id}
                artwork={artwork}
                selected={artwork.id === current.artwork.id}
                meta={score !== null ? `Збіг ${Math.round(score * 100)}%` : undefined}
                onClick={() => pick(artwork)}
                onZoom={() => setZoomed(artwork)}
              />
            ))}
          </div>
        </section>
      )}

      {zoomed && (() => {
        const items = match.alternatives.map((a) => a.artwork);
        const i = items.findIndex((a) => a.id === zoomed.id);
        return (
          <PaintingViewer
            artwork={zoomed}
            onClose={() => setZoomed(null)}
            onPrev={i > 0 ? () => setZoomed(items[i - 1]) : undefined}
            onNext={i >= 0 && i < items.length - 1 ? () => setZoomed(items[i + 1]) : undefined}
            position={i >= 0 ? `${i + 1} / ${items.length}` : undefined}
          >
            {zoomed.id === current.artwork.id ? (
              <Button variant="secondary" className="border-white/60 text-white hover:bg-white/10" onClick={() => setZoomed(null)}>Вже обрано · Повернутися</Button>
            ) : (
              <Button onClick={() => { pick(zoomed); setZoomed(null); }}>Обрати цю картину</Button>
            )}
          </PaintingViewer>
        );
      })()}
    </Page>
  );
}
