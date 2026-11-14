/**
 * Screen 3 · Конструктор — результат  +  3b · Редагування підпису (US-01, US-03, US-04).
 * URL: /create/result?q=<phrase>&d=<description>
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { api } from "../api/client";
import type { ArtworkSummary, Story } from "../api/types";
import { useApi } from "../api/useApi";
import { Button, IconButton } from "../components/Button";
import { ArtworkCard } from "../components/cards";
import { Input } from "../components/Input";
import { ErrorMessage, Loading, Page } from "../components/Layout";
import { ModeSwitch } from "../components/ModeSwitch";
import { CaptionControls } from "../editor/CaptionControls";
import { MemeWorkspace, useSaveMeme } from "../editor/MemeWorkspace";
import { useMemeDraft } from "../editor/useMemeDraft";

export function PhraseResultPage() {
  const [params] = useSearchParams();
  const phrase = params.get("q") ?? "";
  const description = params.get("d") ?? undefined;

  const { data: match, error, loading, reload } = useApi(() => api.match(phrase, description), [phrase, description]);
  const [selected, setSelected] = useState<{ artwork: ArtworkSummary; story: Story | null } | null>(null);
  const [editing, setEditing] = useState(false);
  const current = selected;
  const draft = useMemeDraft(phrase);
  const { stageRef, save, saving, error: saveError } = useSaveMeme((style, png) =>
    api.createMeme(current!.artwork.id, style, png),
  );

  useEffect(() => {
    if (match) {
      setSelected({ artwork: match.artwork, story: match.story });
      draft.update(0, { text: match.caption, position: match.position });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match]);

  const pick = async (artwork: ArtworkSummary) => {
    setSelected({ artwork, story: null });
    const detail = await api.artwork(artwork.id); // default story for this painting
    setSelected({ artwork, story: detail.story });
  };

  const nextAlternative = () => {
    if (!match || !current) return;
    const alts = match.alternatives;
    const i = alts.findIndex((a) => a.artwork.id === current.artwork.id);
    pick(alts[(i + 1) % alts.length].artwork);
  };

  if (!phrase) return <Page title="Ваш мем"><ErrorMessage error="Напишіть фразу на головній сторінці" /></Page>;
  if (loading) return <Page title="Ваш мем"><Loading text="Шукаємо картину…" /></Page>;
  if (error || !match || !current) return <Page title="Ваш мем"><ErrorMessage error={error ?? "Помилка"} onRetry={reload} /></Page>;

  return (
    <Page
      title={editing ? "Редагування" : "Ваш мем"}
      subtitle={editing ? "Перетягніть підпис на картині або змініть його стиль під нею" : "Ми підібрали картину. Не те? Оберіть іншу з топ-5 нижче. Натисніть на підпис, щоб його змінити."}
      actions={
        editing ? (
          <Button onClick={() => save(draft.style)} disabled={saving}>Зберегти в «Мої меми»</Button>
        ) : (
          <ModeSwitch />
        )
      }
    >
      {saveError && <ErrorMessage error={saveError} />}
      <MemeWorkspace
        artwork={current.artwork}
        story={current.story}
        draft={draft}
        editing={editing}
        onEditingChange={setEditing}
        onSave={() => save(draft.style)}
        stageRef={stageRef}
        onAnotherPainting={editing ? nextAlternative : undefined}
      >
        {editing ? (
          <CaptionControls draft={draft} />
        ) : (
          <>
            <div className="t-label mb-3">Підпис</div>
            <div className="flex gap-3">
              <Input value={draft.blocks[0].text} onChange={(e) => draft.setText(e.target.value)} maxLength={200} />
              {/* TODO(team): design shows a refresh icon here — regenerate caption? another painting? */}
              <IconButton icon="refresh" label="Інша картина" onClick={nextAlternative} />
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
          <div className="grid grid-cols-5 gap-6">
            {match.alternatives.map(({ artwork, score }, i) => (
              <ArtworkCard
                key={artwork.id}
                artwork={artwork}
                selected={artwork.id === current.artwork.id}
                meta={`${artwork.artist.name}${score !== null ? ` · збіг ${Math.round(score * 100)}%` : ""}`}
                onClick={() => (i === 0 ? setSelected({ artwork: match.artwork, story: match.story }) : pick(artwork))}
              />
            ))}
          </div>
        </section>
      )}
    </Page>
  );
}
