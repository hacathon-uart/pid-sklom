import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type PointerEvent, type ReactNode, type WheelEvent } from "react";
import type { ArtworkSummary } from "../api/types";
import { Icon, type IconName } from "./Icon";

const MIN = 1;
const MAX = 5;
const STEP = 1.5;

type View = { s: number; x: number; y: number };
const RESET: View = { s: 1, x: 0, y: 0 };

/**
 * Full-screen look at a painting: zoom with the wheel, a pinch, double click / double tap or the ± buttons,
 * drag to pan. ← → switch between neighbours when onPrev / onNext are given. `children` are the actions
 * («Обрати цю картину», «Зробити мем»…), shown under the title.
 */
export function PaintingViewer({
  artwork,
  onClose,
  onPrev,
  onNext,
  position,
  children,
}: {
  artwork: ArtworkSummary;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  position?: string; // e.g. "3 / 12"
  children?: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Which control gets focus after the stage remounts: «Закрити» on open, the same arrow after prev/next,
  // so a second Enter moves on instead of closing the viewer.
  const lastNav = useRef<"close" | "prev" | "next">("close");
  const prev = onPrev && (() => { lastNav.current = "prev"; onPrev(); });
  const next = onNext && (() => { lastNav.current = "next"; onNext(); });

  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    const previousFocus = document.activeElement;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      root.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-label={`«${artwork.title}», ${artwork.artist.name}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" && prev) prev();
        else if (e.key === "ArrowRight" && next) next();
      }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-hidden bg-[#1c1712] p-0 text-white backdrop:bg-black/60"
    >
      <div className="flex h-full flex-col">
        {/* key: a new painting starts unzoomed */}
        <ZoomStage key={artwork.id} artwork={artwork} onPrev={prev} onNext={next} onClose={onClose} focus={lastNav.current} />

        <div className="shrink-0 border-t border-white/10 bg-[#1c1712] px-[var(--page-gutter)] py-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
          <div className="mx-auto flex max-w-[1150px] flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 [overflow-wrap:anywhere]">
              <div className="t-strong text-white">
                «{artwork.title}»{artwork.year ? `, ${artwork.year}` : ""}
              </div>
              <div className="t-small text-white/70">
                {artwork.artist.name}
                {position ? ` · ${position}` : ""}
              </div>
            </div>
            {children && <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end md:shrink-0">{children}</div>}
          </div>
        </div>
      </div>
    </dialog>
  );
}

function ZoomStage({
  artwork,
  onPrev,
  onNext,
  onClose,
  focus,
}: {
  artwork: ArtworkSummary;
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
  focus: "close" | "prev" | "next";
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [view, setView] = useState<View>(RESET);
  const [full, setFull] = useState(false); // the big image has loaded; until then the thumbnail is shown
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; moved: boolean; lastTap: number }>({ dist: 0, moved: false, lastTap: 0 });

  // Preload the full-size picture. crossOrigin: same reason as in Artwork.tsx (shared cache with Konva).
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setFull(true);
    img.src = artwork.image_url;
    return () => { img.onload = null; };
  }, [artwork.image_url]);

  /** Keep the picture inside the stage: no panning past its edges. */
  const clamp = (v: View): View => {
    const stage = stageRef.current;
    const img = imgRef.current;
    const s = Math.min(MAX, Math.max(MIN, v.s));
    if (!stage || !img || s === 1) return { s, x: 0, y: 0 };
    const maxX = Math.max(0, (img.offsetWidth * s - stage.clientWidth) / 2);
    const maxY = Math.max(0, (img.offsetHeight * s - stage.clientHeight) / 2);
    return { s, x: Math.min(maxX, Math.max(-maxX, v.x)), y: Math.min(maxY, Math.max(-maxY, v.y)) };
  };

  /** Zoom to `next`, keeping the point (cx, cy) — client coordinates — still under the cursor/finger. */
  const zoomAt = (next: number, cx?: number, cy?: number) => {
    setView((v) => {
      const stage = stageRef.current;
      const s = Math.min(MAX, Math.max(MIN, next));
      if (!stage || cx === undefined || cy === undefined) return clamp({ s, x: (v.x * s) / v.s, y: (v.y * s) / v.s });
      const r = stage.getBoundingClientRect();
      const px = cx - (r.left + r.width / 2);
      const py = cy - (r.top + r.height / 2);
      return clamp({ s, x: px - ((px - v.x) * s) / v.s, y: py - ((py - v.y) * s) / v.s });
    });
  };

  const onWheel = (e: WheelEvent) => {
    zoomAt(view.s * Math.exp(-e.deltaY * 0.002), e.clientX, e.clientY);
  };

  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const onPointerDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gesture.current.moved = false;
    if (pointers.current.size === 2) gesture.current.dist = distance();
  };

  const onPointerMove = (e: PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    if (Math.hypot(cur.x - prev.x, cur.y - prev.y) > 2) gesture.current.moved = true;
    pointers.current.set(e.pointerId, cur);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = distance();
      const ratio = d / (gesture.current.dist || d);
      gesture.current.dist = d;
      zoomAt(view.s * ratio, (a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (pointers.current.size === 1 && view.s > 1) {
      setView((v) => clamp({ s: v.s, x: v.x + cur.x - prev.x, y: v.y + cur.y - prev.y }));
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    if (gesture.current.moved || pointers.current.size > 0) return;
    // Double tap / double click toggles zoom at that point.
    const now = Date.now();
    if (now - gesture.current.lastTap < 300) {
      gesture.current.lastTap = 0;
      if (view.s > 1) setView(RESET);
      else zoomAt(2.5, e.clientX, e.clientY);
    } else {
      gesture.current.lastTap = now;
    }
  };

  const cursor = view.s > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in";

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={stageRef}
        className={`absolute inset-0 flex touch-none items-center justify-center overflow-hidden p-4 select-none md:p-8 ${cursor}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <img
          ref={imgRef}
          src={full ? artwork.image_url : artwork.thumb_url}
          alt={artwork.title}
          crossOrigin="anonymous"
          draggable={false}
          className="block max-h-full max-w-full object-contain shadow-2xl"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`,
            transition: pointers.current.size ? "none" : "transform 120ms ease-out",
          }}
        />
        {!full && <div className="t-small absolute bottom-4 left-1/2 -translate-x-1/2 rounded-control bg-black/50 px-3 py-1 text-white/80">Завантажуємо…</div>}
      </div>

      <div className="absolute top-3 right-3 flex gap-2 md:top-5 md:right-5">
        <ViewerButton icon="minus" label="Зменшити" onClick={() => zoomAt(view.s / STEP)} disabled={view.s <= MIN} />
        <ViewerButton icon="plus" label="Збільшити" onClick={() => zoomAt(view.s * STEP)} disabled={view.s >= MAX} />
        <ViewerButton icon="close" label="Закрити" onClick={onClose} autoFocus={focus === "close" || (focus === "prev" && !onPrev) || (focus === "next" && !onNext)} />
      </div>
      {onPrev && (
        <ViewerButton icon="chevronLeft" label="Попередня картина" onClick={onPrev} autoFocus={focus === "prev"} className="absolute top-1/2 left-2 -translate-y-1/2 md:left-5" />
      )}
      {onNext && (
        <ViewerButton icon="chevronRight" label="Наступна картина" onClick={onNext} autoFocus={focus === "next"} className="absolute top-1/2 right-2 -translate-y-1/2 md:right-5" />
      )}
    </div>
  );
}

function ViewerButton({
  icon,
  label,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white transition hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-30 ${className}`}
      {...props}
    >
      <Icon name={icon} size={22} />
    </button>
  );
}
