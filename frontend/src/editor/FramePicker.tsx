/** «Рамка» row under a meme: pick the picture frame and whether downloads include it. */
import { FRAME_LABELS, type Frame } from "../api/types";

const FRAMES = Object.keys(FRAME_LABELS) as Frame[];

export function FramePicker({
  frame,
  onFrameChange,
  withFrame,
  onWithFrameChange,
}: {
  frame: Frame;
  onFrameChange?: (frame: Frame) => void; // omit → only the download checkbox (public share page)
  withFrame: boolean;
  onWithFrameChange: (withFrame: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      {onFrameChange && <>
      <div className="t-label">Рамка</div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Рамка">
        {FRAMES.map((f) => (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={frame === f}
            title={FRAME_LABELS[f]}
            onClick={() => onFrameChange(f)}
            className={`flex min-h-11 min-w-11 flex-col items-center gap-1 rounded-control border p-1.5 text-[11px] transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${frame === f ? "border-accent text-accent" : "border-line hover:bg-muted"}`}
          >
            <span className={`frame frame-${f} frame-sm block`} style={{ ["--fw" as string]: "4px" }}>
              <span className="frame-inner block">
                <span className="block h-6 w-6 bg-image" />
              </span>
            </span>
            {FRAME_LABELS[f]}
          </button>
        ))}
      </div>
      </>}
      <label className="t-small flex min-h-11 cursor-pointer items-center gap-2">
        <input type="checkbox" checked={withFrame} onChange={(e) => onWithFrameChange(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
        Завантажувати з рамкою
      </label>
    </div>
  );
}
