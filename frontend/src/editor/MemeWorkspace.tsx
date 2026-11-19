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
 * The frame (draft.frame) is part of the draft; account changes require explicit Save.
 *
 * The page owns `stageRef` (from useMemeEditor) so its header «Зберегти» button can export the canvas.
 */
import type Konva from "konva";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link } from "react-router";
import type { ArtworkSummary, Story } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { authEnabled } from "../auth/supabase";
import { pending, RESUME, remove, route, useTabState } from "../auth/workflow";
import { Artwork } from "../components/Artwork";
import { Icon, type IconName } from "../components/Icon";
import { ErrorMessage } from "../components/Layout";
import { StoryCard } from "../components/StoryCard";
import type { Frame } from "../api/types";
import { exportPng, framePng } from "./exportPng";
import { FramePicker } from "./FramePicker";
import { MemeCanvas } from "./MemeCanvas";
import type { MemeDraft } from "./useMemeDraft";
import { useMemeExport } from "./useMemeExport";

export type StoryState =
  | { status: "loading" }
  | { status: "ready"; story: Story }
  | { status: "unavailable" }
  | { status: "error"; message: string; retry: () => void };

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
  story: StoryState;
  draft: MemeDraft;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onSave: () => void;
  savedId?: string | null; // fills the bookmark
  stageRef: RefObject<Konva.Stage | null>;
  onAnotherPainting?: () => void;
  toolbarEnd?: ReactNode; // right end of the icon row under the meme (e.g. «Скасувати» / «Зберегти зміни»)
  children?: ReactNode;
}) {
  const saved = !!savedId;
  const { user } = useAuth();
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const canvasZone = useRef<HTMLDivElement>(null);
  const [withFrame, setWithFrame] = useTabState(`export-frame:artwork:${artwork.id}`, true);

  // Crack the glass when the meme becomes saved (not when an already-saved meme is opened).
  const [crackRun, setCrackRun] = useState(0);
  const wasSaved = useRef(saved);
  useEffect(() => {
    if (saved && !wasSaved.current) setCrackRun((n) => n + 1);
    wasSaved.current = saved;
  }, [saved]);

  const changeFrame = (frame: Frame) => {
    draft.setFrame(frame);
  };
  const png = async () => {
    await document.fonts.ready;
    const plain = exportPng(stageRef.current!);
    return withFrame ? framePng(plain, draft.frame) : plain;
  };
  const exporting = useMemeExport(
    `artwork:${artwork.id}`, artwork.id, png,
    () => Boolean(stageRef.current?.getAttr("exportReady")) && !stageRef.current?.getAttr("exportError"),
  );
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
    // Pressing a button or link never closes the editor: closing collapses the controls and can shift the
    // layout under the cursor, which would swallow the click (e.g. the first press of «Зберегти»).
    const close = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (t instanceof Element && t.closest("button, a, dialog")) return;
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
    <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10 xl:gap-14">
      <div className="min-w-0">
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
        <a href="#artwork-story" className="t-small mt-3 inline-flex min-h-11 items-center text-accent underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-accent">Читати історію картини ↓</a>
        {authEnabled && <p className="t-small mt-4 text-text-secondary">Збережені меми та PNG доступні всім, хто має посилання.</p>}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {!editing && <button type="button" className="t-strong min-h-11 rounded-control border border-accent px-4 text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onClick={() => onEditingChange(true)}>Редагувати підпис</button>}
          {authEnabled && <WorkspaceAction icon="bookmark" label={saved ? "Зберегти зміни" : "Зберегти в «Мої меми»"} visibleLabel="Зберегти" active={saved} onClick={onSave} />}
          <WorkspaceAction
            icon="download"
            label="Завантажити PNG"
            visibleLabel="Завантажити"
            disabled={exporting.busy}
            onClick={() => void exporting.run("download")}
          />
          <WorkspaceAction
            icon="share"
            label="Поділитися"
            disabled={exporting.busy}
            onClick={() => void exporting.run("share")}
          />
          {onAnotherPainting && <WorkspaceAction icon="refresh" label="Інша картина" onClick={onAnotherPainting} />}
          {toolbarEnd && <div className="flex w-full flex-wrap items-center gap-3 sm:ml-auto sm:w-auto">{toolbarEnd}</div>}
        </div>
        {workspaceError && <ErrorMessage error={workspaceError} />}
        {exporting.error && <ErrorMessage error={exporting.error} />}
        {exporting.notice && <p role="status" className="t-small mt-3">{exporting.notice}</p>}
        <div className="mt-5">
          <FramePicker frame={draft.frame} onFrameChange={changeFrame} withFrame={withFrame} onWithFrameChange={setWithFrame} />
        </div>
        <div ref={controlsZone} className="mt-6">{children}</div>
      </div>
      <div id="artwork-story" role="region" tabIndex={-1} aria-label="Історія картини" aria-busy={story.status === "loading"} className="min-w-0 scroll-mt-6">
        {story.status === "ready" ? <StoryCard artwork={artwork} story={story.story} /> : (
          <div className="t-body rounded-story border border-line bg-surface p-6 text-text-secondary">
            {story.status === "error" ? (
              <>
                <p role="alert">{story.message}</p>
                <button type="button" className="t-strong mt-3 min-h-11 rounded-control px-3 text-accent focus-visible:outline-2 focus-visible:outline-accent" onClick={story.retry}>Спробувати ще раз</button>
              </>
            ) : <p role="status">{story.status === "loading" ? "Завантажуємо історію картини…" : "Історія цієї картини зараз недоступна."}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function WorkspaceAction({ icon, label, visibleLabel = label, active = false, disabled, onClick }: {
  icon: IconName;
  label: string;
  visibleLabel?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
    className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-line bg-surface px-3 text-[13px] font-semibold transition hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40 lg:w-11 lg:px-0 ${active ? "text-accent" : "text-text"}`}>
    <Icon name={icon} filled={active} size={19} />
    <span className="lg:sr-only">{visibleLabel}</span>
  </button>;
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
