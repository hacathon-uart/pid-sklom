import type { ReactNode } from "react";
import type { Frame } from "../api/types";

/**
 * A painting in a picture frame, behind glass (styles in index.css → «Museum visuals»).
 * `children` is rendered instead of the <img> (e.g. the Konva editor canvas).
 *
 * frame  — moulding style; memes use MemeStyle.frame, everything else the gold default.
 * size   — moulding thickness: "sm" for small thumbnails, "lg" for the big meme.
 * crack  — cracked glass over the picture: "static" (favourite memes), "animate" (just liked),
 *          "fleeting" (plays once and fades: the save moment in the editor).
 */
export function Artwork({
  src,
  alt,
  selected = false,
  aspect,
  frame = "gold",
  size = "md",
  crack,
  crackKey,
  children,
  className = "",
}: {
  src?: string | null;
  alt?: string;
  selected?: boolean;
  aspect?: string; // e.g. "4/5"; omit to use the image's own ratio
  frame?: Frame;
  size?: "sm" | "md" | "lg";
  crack?: "static" | "animate" | "fleeting" | null;
  crackKey?: number; // change it to replay the crack animation
  children?: ReactNode;
  className?: string;
}) {
  const sizeClass = size === "md" ? "" : `frame-${size}`;
  return (
    <div className={`frame frame-${frame} ${sizeClass} ${selected ? "frame-selected" : ""} ${className}`}>
      <div className="frame-inner">
        <div className="glass flex items-center justify-center bg-image" style={aspect ? { aspectRatio: aspect } : undefined}>
          {children ??
            (src ? (
              // crossOrigin on EVERY artwork <img>: otherwise the browser caches a non-CORS copy and the
              // meme editor (Konva, which needs CORS for PNG export) fails to load the same URL.
              <img src={src} alt={alt ?? ""} crossOrigin="anonymous" className="block h-full w-full object-cover" loading="lazy" />
            ) : (
              <span className="t-small text-text-secondary">Картина</span>
            ))}
          {crack && <Crack key={crackKey} mode={crack} />}
        </div>
      </div>
    </div>
  );
}

/** Cracks radiating from one impact point (top right). Drawn twice: a dark shade + a white shine line. */
const CRACK_PATHS = [
  "M72 26 64 38 68 45 57 61 60 70 52 84",
  "M72 26 84 32 93 31 100 36",
  "M72 26 76 14 74 4",
  "M72 26 61 24 48 28 40 26",
  "M64 38 53 41 46 49",
  "M72 26 80 42 86 50 88 62",
  "M68 45 76 52",
  "M61 24 56 14",
];

export function Crack({ mode }: { mode: "static" | "animate" | "fleeting" }) {
  return (
    <svg
      className={`crack ${mode === "animate" ? "crack-animate" : mode === "fleeting" ? "crack-fleeting" : ""}`}
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      {CRACK_PATHS.map((d) => (
        <path key={`s${d}`} className="shade" d={d} />
      ))}
      {CRACK_PATHS.map((d) => (
        <path key={d} className="shine" d={d} />
      ))}
      <circle cx="72" cy="26" r="1.2" fill="rgba(255,255,255,.95)" />
    </svg>
  );
}
