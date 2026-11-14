/**
 * Shared layout of every result screen (3, 3b, 3c, 3d, edit saved meme):
 *   left  — meme canvas, action icons, page-specific controls (`children`)
 *   right — StoryCard
 *
 * Caption editing: clicking the caption on the canvas calls onEditingChange(true); clicking the canvas
 * background or anything outside the canvas and the controls calls onEditingChange(false). The page decides what
 * «editing» shows (CaptionControls panel).
 * The heart = «save to my account» (asks to log in first), same as the header «Зберегти» button.
 *
 * The page owns `stageRef` (from useSaveMeme) so its header «Зберегти» button can export the canvas.
 */
import type Konva from "konva";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useNavigate } from "react-router";
import { ApiError } from "../api/client";
import type { ArtworkSummary, MemeStyle, Story } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { Artwork } from "../components/Artwork";
import { IconButton } from "../components/Button";
import { StoryCard } from "../components/StoryCard";
import { downloadDataUrl, exportPng, shareMeme } from "./exportPng";
import { MemeCanvas } from "./MemeCanvas";
import type { MemeDraft } from "./useMemeDraft";

export function MemeWorkspace({
  artwork,
  story,
  draft,
  editing,
  onEditingChange,
  onSave,
  stageRef,
  onAnotherPainting,
  children,
}: {
  artwork: ArtworkSummary;
  story: Story | null;
  draft: MemeDraft;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onSave: () => void;
  stageRef: RefObject<Konva.Stage | null>;
  onAnotherPainting?: () => void;
  children?: ReactNode;
}) {
  const canvasZone = useRef<HTMLDivElement>(null);
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
        <Artwork>
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
          <IconButton icon="heart" label="Зберегти в «Мої меми»" onClick={onSave} />
          <IconButton
            icon="download"
            label="Завантажити PNG"
            onClick={() => stageRef.current && downloadDataUrl(exportPng(stageRef.current))}
          />
          <IconButton
            icon="share"
            label="Поділитися"
            onClick={() => stageRef.current && shareMeme(exportPng(stageRef.current))}
          />
          {onAnotherPainting && <IconButton icon="refresh" label="Інша картина" onClick={onAnotherPainting} />}
        </div>
        <div ref={controlsZone} className="mt-6">{children}</div>
      </div>
      {story ? <StoryCard artwork={artwork} story={story} /> : <div className="h-96 animate-pulse rounded-story bg-muted" />}
    </div>
  );
}

/**
 * «Зберегти в «Мої меми»». Asks to log in first if needed (US-06), exports the PNG,
 * calls `persist` (create or update), then opens the saved meme.
 */
export function useSaveMeme(persist: (style: MemeStyle, png: string) => Promise<{ id: string }>) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const { requireLogin } = useAuth();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = (style: MemeStyle) =>
    requireLogin(async () => {
      const stage = stageRef.current;
      if (!stage) return;
      setSaving(true);
      setError(null);
      try {
        const meme = await persist(style, exportPng(stage));
        navigate(`/me/memes/${meme.id}`);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Не вдалося зберегти мем");
      } finally {
        setSaving(false);
      }
    });

  return { stageRef, save, saving, error };
}
