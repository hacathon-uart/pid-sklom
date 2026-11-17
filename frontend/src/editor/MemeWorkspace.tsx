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
import { api } from "../api/client";
import type { ArtworkSummary, MemeStyle, Story } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { authEnabled } from "../auth/supabase";
import { pending, read, RESUME, remove, route, write } from "../auth/workflow";
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
  onSave: () => void;
  savedId?: string | null; // fills the bookmark; frame changes are saved to it
  stageRef: RefObject<Konva.Stage | null>;
  onAnotherPainting?: () => void;
  toolbarEnd?: ReactNode; // right end of the icon row under the meme (e.g. «Скасувати» / «Зберегти зміни»)
  children?: ReactNode;
}) {
  const saved = !!savedId;
  const { user } = useAuth();
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
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
    if (savedId) void api.updateMeme(savedId, { style: { ...draft.style, frame } })
      .catch((failure: Error) => setWorkspaceError(`Рамку не збережено: ${failure.message}`));
  };
  const png = async () => {
    const plain = exportPng(stageRef.current!);
    return withFrame ? framePng(plain, draft.frame) : plain;
  };
  const controlsZone = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const action = pending(RESUME);
    if (!user || action?.kind !== "save" || action.route !== route()) return;
    const deadline = Date.now() + 30000;
    const timer = window.setInterval(() => {
      const stage = stageRef.current;
      if (stage?.getAttr("exportError") || Date.now() > deadline) {
        remove(RESUME);
        setWorkspaceError("Не вдалося підготувати PNG. Чернетку збережено; спробуйте зберегти ще раз");
        window.clearInterval(timer);
      } else if (stage?.getAttr("exportReady")) {
        remove(RESUME);
        window.clearInterval(timer);
        onSave();
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [user, stageRef, onSave]);

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
          {authEnabled && <IconButton icon="bookmark" label={saved ? "Зберегти зміни" : "Зберегти в «Мої меми»"} active={saved} onClick={onSave} />}
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
        {authEnabled && <p className="t-small mt-3 text-text-secondary">Збережені меми та PNG доступні всім, хто має посилання.</p>}
        {workspaceError && <ErrorMessage error={workspaceError} />}
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
 * Shared save logic, including a durable intent across Google redirects/retries.
 * Repeated saves update the same meme. Deletion is a separate confirmed action.
 * `initialId`: the meme is already saved (edit screen).
 */
export function useSaveMeme(
  persist: (style: MemeStyle, png: string, intent: string) => Promise<{ id: string }>,
  initialId: string | null = null,
) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const { requireLogin, user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(() =>
    initialId ?? read<string>(`saved:${user?.id}:${route()}`),
  );
  const [justSaved, setJustSaved] = useState(false); // shows the «Збережено» notice
  const busy = useRef(false);
  const intentKey = `save:${route()}`;

  const save = (style: MemeStyle) => {
    if (busy.current) return;
    if (!authEnabled) {
      setError("Збереження в акаунт поки недоступне. Завантажте мем як PNG");
      return;
    }
    let intent: { id: string; style: MemeStyle };
    try {
      const previous = read<{ id: string; style: MemeStyle }>(intentKey);
      if (previous && JSON.stringify(previous.style) === JSON.stringify(style)) intent = previous;
      else {
        if (!savedId && !window.confirm("Збережений мем і PNG будуть доступні всім, хто має посилання. Зберегти?")) return;
        intent = { id: crypto.randomUUID(), style };
        write(intentKey, intent);
      }
    } catch (failure) {
      setError((failure as Error).message);
      return;
    }
    requireLogin(async () => {
      busy.current = true;
      setSaving(true);
      setError(null);
      try {
        const stage = stageRef.current;
        if (!stage?.getAttr("exportReady")) throw new Error("Зображення та шрифти ще завантажуються. Спробуйте ще раз");
        const png = exportPng(stage);
        const meme = savedId ? await api.updateMeme(savedId, { style, image_data_url: png }) : await persist(style, png, intent.id);
        setSavedId(meme.id);
        write(`saved:${user?.id}:${route()}`, meme.id);
        remove(intentKey);
        setJustSaved(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не вдалося виконати дію");
      } finally {
        busy.current = false;
        setSaving(false);
      }
    }, { kind: "save", route: route(), id: intent.id });
  };

  const toggle = save;

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
