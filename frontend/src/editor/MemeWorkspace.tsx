/**
 * Shared layout of every result screen (3, 3b, 3c, 3d, edit saved meme):
 *   left  — meme canvas, action icons, page-specific controls (`children`)
 *   right — StoryCard
 *
 * Caption editing: clicking the caption on the canvas calls onEditingChange(true); clicking the canvas
 * background or anything outside the canvas and the controls calls onEditingChange(false). The page decides what
 * «editing» shows (CaptionControls panel).
 * The bookmark (ticket) icon = «save to my account» (asks to log in first). Saving cracks the glass for a
 * moment (G3). There is no heart here: ♥ (is_favorite) exists only on saved memes, in the account
 * (MemeViewPage), where favourites keep the crack.
 * The frame (draft.frame) is part of the style; picking one on a saved meme saves it right away.
 *
 * The page owns `stageRef` (from useSaveMeme) so its header «Зберегти» button can export the canvas.
 */
import type Konva from "konva";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link } from "react-router";
import { api, ApiError } from "../api/client";
import type { ArtworkSummary, MemeStyle, Story } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { Artwork } from "../components/Artwork";
import { IconButton } from "../components/Button";
import { ErrorMessage } from "../components/Layout";
import { StoryCard } from "../components/StoryCard";
import type { Frame } from "../api/types";
import { downloadDataUrl, exportPng, framePng, shareMeme } from "./exportPng";
import { FramePicker } from "./FramePicker";
import { MemeCanvas } from "./MemeCanvas";
import type { MemeDraft } from "./useMemeDraft";

export function MemeWorkspace({
  artwork,
  story,
  draft,
  editing,
  onEditingChange,
  onSave,
  savedId = null,
  stageRef,
  onAnotherPainting,
  toolbarEnd,
  children,
}: {
  artwork: ArtworkSummary;
  story: Story | null;
  draft: MemeDraft;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onSave: () => void; // bookmark: save / un-save
  savedId?: string | null; // fills the bookmark; frame changes are saved to it
  stageRef: RefObject<Konva.Stage | null>;
  onAnotherPainting?: () => void;
  toolbarEnd?: ReactNode; // right end of the icon row under the meme (e.g. «Скасувати» / «Зберегти зміни»)
  children?: ReactNode;
}) {
  const saved = !!savedId;
  const canvasZone = useRef<HTMLDivElement>(null);
  const [withFrame, setWithFrame] = useState(true);

  // Crack the glass when the meme becomes saved (not when an already-saved meme is opened).
  const [crackRun, setCrackRun] = useState(0);
  const wasSaved = useRef(saved);
  useEffect(() => {
    if (saved && !wasSaved.current) setCrackRun((n) => n + 1);
    wasSaved.current = saved;
  }, [saved]);

  const changeFrame = (frame: Frame) => {
    draft.setFrame(frame);
    if (savedId) api.updateMeme(savedId, { style: { ...draft.style, frame } }).catch(() => {});
  };
  const png = async () => {
    const plain = exportPng(stageRef.current!);
    return withFrame ? framePng(plain, draft.frame) : plain;
  };
  const controlsZone = useRef<HTMLDivElement>(null);

  // A click anywhere except the canvas and the page controls (`children`) closes the caption editor,
  // including the icon row and the empty space around it.
  useEffect(() => {
    if (!editing) return;
    const close = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (!canvasZone.current?.contains(t) && !controlsZone.current?.contains(t)) onEditingChange(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
    };
  }, [editing, onEditingChange]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-14">
      <div>
        <div ref={canvasZone}>
        <Artwork frame={draft.frame} size="lg" crack={crackRun ? "fleeting" : null} crackKey={crackRun}>
          <MemeCanvas
            imageUrl={artwork.image_url}
            blocks={draft.blocks}
            editable={editing}
            active={draft.active}
            onSelect={(i) => {
              draft.setActive(i);
              onEditingChange(true);
            }}
            onBackgroundClick={() => onEditingChange(false)}
            onMove={(i, x, y) => draft.update(i, { x, y })}
            stageRef={stageRef}
          />
        </Artwork>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <IconButton icon="bookmark" label={saved ? "Видалити з «Моїх мемів»" : "Зберегти в «Мої меми»"} active={saved} onClick={onSave} />
          <IconButton
            icon="download"
            label="Завантажити PNG"
            onClick={async () => stageRef.current && downloadDataUrl(await png())}
          />
          <IconButton
            icon="share"
            label="Поділитися"
            onClick={async () => stageRef.current && shareMeme(await png())}
          />
          {onAnotherPainting && <IconButton icon="refresh" label="Інша картина" onClick={onAnotherPainting} />}
          {toolbarEnd && <div className="ml-auto flex items-center gap-3">{toolbarEnd}</div>}
        </div>
        <div className="mt-5">
          <FramePicker frame={draft.frame} onFrameChange={changeFrame} withFrame={withFrame} onWithFrameChange={setWithFrame} />
        </div>
        <div ref={controlsZone} className="mt-6">{children}</div>
      </div>
      {story ? <StoryCard artwork={artwork} story={story} /> : <div className="h-96 animate-pulse rounded-story bg-muted" />}
    </div>
  );
}

/**
 * Bookmark logic for every editor screen. `toggle` saves, or un-saves if already saved (no confirmation).
 * Asks to log in first if needed (US-06). The user stays on the page; saving again after the first save
 * updates the same meme, and saving after an un-save creates a new one (via `persist`).
 * `initialId`: the meme is already saved (edit screen).
 */
export function useSaveMeme(
  persist: (style: MemeStyle, png: string) => Promise<{ id: string }>,
  initialId: string | null = null,
) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const { requireLogin } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(initialId);
  const [justSaved, setJustSaved] = useState(false); // shows the «Збережено» notice

  const run = (fn: () => Promise<void>) =>
    requireLogin(async () => {
      setSaving(true);
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Не вдалося виконати дію");
      } finally {
        setSaving(false);
      }
    });

  const save = (style: MemeStyle) =>
    run(async () => {
      const stage = stageRef.current;
      if (!stage) return;
      const png = exportPng(stage);
      const meme = savedId ? await api.updateMeme(savedId, { style, image_data_url: png }) : await persist(style, png);
      setSavedId(meme.id);
      setJustSaved(true);
    });

  const unsave = () =>
    run(async () => {
      if (!savedId) return;
      await api.deleteMeme(savedId);
      setSavedId(null);
      setJustSaved(false);
    });

  const toggle = (style: MemeStyle) => (savedId ? unsave() : save(style));

  return { stageRef, save, toggle, saving, error, savedId, justSaved };
}

/** Error or «Збережено» message under the page header. */
export function SaveStatus({ error, savedId, justSaved }: { error: string | null; savedId: string | null; justSaved: boolean }) {
  if (error) return <ErrorMessage error={error} />;
  if (!savedId || !justSaved) return null;
  return (
    <p className="t-small mb-4 rounded-control bg-muted px-4 py-3" role="status">
      Додано до колекції «Мої меми».{" "}
      <Link to={`/me/memes/${savedId}`} className="font-semibold text-accent">
        Відкрити →
      </Link>
    </p>
  );
}
