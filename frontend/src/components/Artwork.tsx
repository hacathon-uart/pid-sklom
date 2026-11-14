import type { ReactNode } from "react";

/**
 * Frame around a painting. Restyle HERE for decorative picture frames later (design README §2).
 * `children` is rendered instead of the <img> (e.g. the Konva editor canvas).
 */
export function Artwork({
  src,
  alt,
  selected = false,
  aspect,
  children,
  className = "",
}: {
  src?: string | null;
  alt?: string;
  selected?: boolean;
  aspect?: string; // e.g. "4/5"; omit to use the image's own ratio
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-white p-2.5 transition ${selected ? "border-[3px] border-accent" : "border border-accent-soft"} ${className}`}
    >
      <div className="flex items-center justify-center overflow-hidden bg-image" style={aspect ? { aspectRatio: aspect } : undefined}>
        {children ??
          (src ? (
            // crossOrigin on EVERY artwork <img>: otherwise the browser caches a non-CORS copy and the
            // meme editor (Konva, which needs CORS for PNG export) fails to load the same URL.
            <img src={src} alt={alt ?? ""} crossOrigin="anonymous" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <span className="t-small text-text-secondary">Картина</span>
          ))}
      </div>
    </div>
  );
}
