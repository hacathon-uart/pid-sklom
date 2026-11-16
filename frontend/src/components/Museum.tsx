/** Small museum pieces: logo, hall titles, wall labels, genre walls, velvet rope, entrance ticket. */
import type { ReactNode } from "react";
import type { Genre } from "../api/types";

/** Logo L4 «Відблиск»: a pane of glass with a glare. Uses currentColor. Same drawing as public/favicon.svg. */
export function LogoMark({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeLinecap="round" className={className} aria-hidden>
      <rect x="20" y="12" width="60" height="76" strokeWidth={size < 48 ? 6 : 3.4} />
      <path d="M34 62 60 30" strokeWidth={size < 48 ? 7 : 4} />
      {size >= 48 && <path d="M44 70 66 43" strokeWidth="2" />}
    </svg>
  );
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];

/** Section heading as a museum hall (D2): «I · Автори». */
export function HallTitle({ n, children, className = "" }: { n: number; children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-end gap-4 ${className}`}>
      <span className="hall-no" aria-hidden>{ROMAN[n - 1] ?? n}</span>
      <h2 className="t-h2">{children}</h2>
    </div>
  );
}

/** Inventory number shown on labels: ПС-0042. */
export const inventoryNo = (id: number | string) =>
  `ПС-${typeof id === "number" ? String(id).padStart(4, "0") : id.slice(0, 4).toUpperCase()}`;

/** White museum label under a painting (D1). */
export function WallLabel({ who, what, inv, invRight = false, className = "" }: { who: ReactNode; what: ReactNode; inv?: ReactNode; invRight?: boolean; className?: string }) {
  return (
    <div className={`wall-label ${className}`}>
      <div className="wl-who truncate">{who}</div>
      <div className="wl-what">{what}</div>
      {inv && <div className={`wl-inv ${invRight ? "text-right" : ""}`}>{inv}</div>}
    </div>
  );
}

/**
 * Full-bleed coloured hall wall by genre (W6). Must sit directly inside <Page> (cancels its px-16).
 * null = «Усі» → the light hall.
 */
export function Wall({ genre, children, className = "" }: { genre: Genre | null; children: ReactNode; className?: string }) {
  return <div className={`wall wall-${genre ?? "everyday"} -mx-16 px-16 py-14 ${className}`}>{children}</div>;
}

/** Velvet rope on brass posts (D3): section divider and empty states. */
export function VelvetRope({ className = "" }: { className?: string }) {
  const post = (x: number) => (
    <g key={x}>
      <rect x={x - 4} y="14" width="8" height="46" />
      <circle cx={x} cy="12" r="6" />
      <rect x={x - 12} y="58" width="24" height="5" />
    </g>
  );
  return (
    <svg viewBox="0 0 400 64" className={`h-14 w-full max-w-[420px] ${className}`} aria-hidden>
      <defs>
        <linearGradient id="rope-brass" x1="0" x2="1">
          <stop offset="0" stopColor="#8a6a2c" />
          <stop offset=".5" stopColor="#f0d690" />
          <stop offset="1" stopColor="#8a6a2c" />
        </linearGradient>
      </defs>
      <path d="M40 20 Q120 52 200 20 Q280 52 360 20" fill="none" stroke="#7b1e2a" strokeWidth="5" strokeLinecap="round" />
      <g fill="url(#rope-brass)">{[40, 200, 360].map(post)}</g>
    </svg>
  );
}

/** Empty state behind a velvet rope. */
export function RopedOff({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center py-12 text-center">
      <VelvetRope />
      <div className="t-body mt-4 max-w-[420px] text-text-secondary">{children}</div>
    </div>
  );
}

/** Entrance ticket (D5): profile header. */
export function Ticket({ title, subtitle, number }: { title: ReactNode; subtitle?: ReactNode; number: ReactNode }) {
  return (
    <div className="ticket">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.14em]">Вхідний квиток</div>
        <div className="font-heading text-xl font-semibold italic leading-tight">{title}</div>
        {subtitle && <div className="text-[12px]">{subtitle}</div>}
      </div>
      <div>№ {number}</div>
    </div>
  );
}
