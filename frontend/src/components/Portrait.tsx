/** Round artist portrait. */
export function Portrait({ src, name, size = 72 }: { src?: string | null; name?: string; size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-image text-[13px] text-text-secondary"
      style={{ width: size, height: size }}
    >
      {src ? <img src={src} alt={name ?? ""} className="h-full w-full object-cover" /> : "фото"}
    </div>
  );
}
