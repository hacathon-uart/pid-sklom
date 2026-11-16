/** Artist portrait as an oval gilded cameo (D6). `size` = height; width is 4/5 of it. */
export function Portrait({ src, name, size = 72 }: { src?: string | null; name?: string; size?: number }) {
  const ring = Math.max(3, Math.round(size * 0.05));
  return (
    <div
      className="shrink-0 rounded-[50%] shadow-[0_6px_14px_-6px_rgba(46,38,32,0.55)]"
      style={{
        width: size * 0.8,
        height: size,
        padding: ring,
        background: "linear-gradient(145deg, #6e4f17, #e3bd62 30%, #a27a2a 55%, #f5dc93 75%, #5c4112)",
      }}
    >
      <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-[50%] bg-image text-[13px] text-text-secondary">
        {src ? <img src={src} alt={name ?? ""} className="h-full w-full object-cover" /> : "фото"}
      </div>
    </div>
  );
}
