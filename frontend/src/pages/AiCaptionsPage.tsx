/** Screen 3c · Картина → підпис — результат: 3 AI captions (US-02, US-03, US-04). */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { api } from "../api/client";
import { CAPTION_KIND_LABELS, type CaptionOption } from "../api/types";
import { useApi } from "../api/useApi";
import { Icon } from "../components/Icon";
import { ErrorMessage, Loading, Page } from "../components/Layout";
import { CaptionControls } from "../editor/CaptionControls";
import { describeStyle } from "../editor/model";
import { MemeWorkspace, SaveStatus } from "../editor/MemeWorkspace";
import { useMemeEditor } from "../editor/useMemeEditor";
import { pending, RESUME, useTabState } from "../auth/workflow";

export function AiCaptionsPage() {
  const artworkId = Number(useParams().artworkId);
  const artwork = useApi(() => api.artwork(artworkId), [artworkId]);
  const [captions, setCaptions] = useTabState<CaptionOption[]>("captions", []);
  const [seen, setSeen] = useTabState<string[]>("seen", []);
  const [loadingCaptions, setLoadingCaptions] = useState(false);
  const [captionsError, setCaptionsError] = useState<string | null>(null);
  const [styleOpen, setStyleOpen] = useState(false);
  const { draft, stageRef, error: saveError, savedId, justSaved, save, share } = useMemeEditor(artworkId);

  const loadCaptions = async (exclude: string[]) => {
    setLoadingCaptions(true);
    setCaptionsError(null);
    try {
      const res = await api.captions(artworkId, exclude);
      setCaptions(res.captions);
      setSeen((s) => [...new Set([...s, ...res.captions.map((c) => c.text)])]);
      if (res.captions[0]) draft.setText(res.captions[0].text);
    } catch (e) {
      setCaptionsError((e as Error).message);
    } finally {
      setLoadingCaptions(false);
    }
  };

  useEffect(() => {
    if (!captions.length || pending(RESUME)?.kind === "generation") void loadCaptions([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artworkId]);

  const back = (
    <Link to={`/create/painting?artwork=${artworkId}`} className="t-strong flex items-center gap-2 text-accent">
      <Icon name="arrowLeft" size={18} /> Обрати іншу картину
    </Link>
  );

  if (artwork.loading) return <Page title="Підпис для картини" back={back}><Loading /></Page>;
  if (artwork.error || !artwork.data)
    return <Page title="Підпис для картини" back={back}><ErrorMessage error={artwork.error ?? "Помилка"} onRetry={artwork.reload} /></Page>;

  const text = draft.blocks[0].text;
  return (
    <Page
      title="Підпис для картини"
      back={back}
    >
      <SaveStatus error={saveError} savedId={savedId} justSaved={justSaved} />
      <MemeWorkspace artwork={artwork.data} story={artwork.data.story ? { status: "ready", story: artwork.data.story } : { status: "unavailable" }} draft={draft} editing={styleOpen} onEditingChange={setStyleOpen} onSave={save} onShare={share}
        savedId={savedId} stageRef={stageRef}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="t-label">Підписи від ШІ</div>
          <button className="t-strong flex items-center gap-2 text-accent" onClick={() => loadCaptions(seen)} disabled={loadingCaptions}>
            <Icon name="refresh" size={18} /> Ще варіанти
          </button>
        </div>
        {captionsError && <ErrorMessage error={captionsError} onRetry={() => loadCaptions(seen)} />}
        <div className={`flex flex-col gap-3 ${loadingCaptions ? "opacity-50" : ""}`}>
          {captions.map((c) => (
            <label
              key={c.text}
              className={`flex min-h-11 cursor-pointer flex-wrap items-start gap-3 rounded-card border px-4 py-4 sm:items-center sm:gap-4 sm:px-5 ${text === c.text ? "border-accent bg-muted" : "border-line bg-surface"}`}
            >
              <input type="radio" name="caption" checked={text === c.text} onChange={() => draft.setText(c.text)} className="accent-accent" />
              <span className="t-body min-w-0 flex-1 basis-[70%] break-words">{c.text}</span>
              <span className="t-small text-text-secondary">{CAPTION_KIND_LABELS[c.kind]}</span>
            </label>
          ))}
        </div>

        <div className="mt-4">
          {styleOpen ? (
            <CaptionControls draft={draft} />
          ) : (
            <button onClick={() => setStyleOpen(true)} className="flex w-full items-center justify-between rounded-card border border-line bg-surface px-5 py-4 text-left">
              <div>
                <div className="t-strong">Стиль підпису</div>
                <div className="t-small text-text-secondary">{describeStyle(draft.blocks[0])}</div>
              </div>
              <span className="t-strong flex items-center gap-1 text-accent">
                Змінити <Icon name="chevronDown" size={18} />
              </span>
            </button>
          )}
        </div>
      </MemeWorkspace>
    </Page>
  );
}
