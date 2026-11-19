/**
 * Gallery hall «Хіти з-під скла»: our best memes, hung as paintings. At first each one is just a painting
 * with its museum label; hover (tap on phones) lands the caption on the glass and the label tells what the
 * painting «really» means. Curated here (saved memes are private), drawn like the landing demo.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../api/client";
import type { ArtworkSummary, Frame } from "../api/types";
import { useApi } from "../api/useApi";
import { Artwork } from "./Artwork";
import { HallTitle, inventoryNo } from "./Museum";

const HITS: { id: number; caption: string }[] = [
  { id: 22, caption: "Коли в групі написали «є новини»" },
  { id: 18, caption: "Коли родичі питають, коли весілля" },
  { id: 93, caption: "Я о третій ночі: ще одне відео" },
  { id: 27, caption: "Кіт вирішив, що досить читати" },
  { id: 10, caption: "Черга в ЦНАП о 7:59" },
  { id: 36, caption: "Сказав «я на хвилинку» три години тому" },
  { id: 21, caption: "Тімбілдинг, який ми заслужили" },
  { id: 63, caption: "Коли питаєш подругу, чи писати колишньому" },
  { id: 59, caption: "Коли гуглиш симптоми" },
];
const FRAMES: Frame[] = ["gold", "gallery", "oak", "gold", "mat", "gallery", "gold", "oak", "gallery"];

/** 1 / 2 / 3 columns. Real columns instead of CSS `columns`: browsers repaint a whole multi-column
 *  box when one item moves on hover, and the paintings in other columns flicker or vanish. */
function useColumnCount() {
  const count = () => (typeof window === "undefined" ? 3 : window.innerWidth >= 1024 ? 3 : window.innerWidth >= 480 ? 2 : 1);
  const [n, setN] = useState(count);
  useEffect(() => {
    const queries = ["(min-width: 480px)", "(min-width: 1024px)"].map((q) => window.matchMedia(q));
    const update = () => setN(count());
    queries.forEach((q) => q.addEventListener("change", update));
    return () => queries.forEach((q) => q.removeEventListener("change", update));
  }, []);
  return n;
}

export function MemeHall({ n }: { n: number }) {
  const { data } = useApi(() => api.artworks({ limit: 200 }), []);
  const byId = new Map((data?.items ?? []).map((a) => [a.id, a]));
  const hits = HITS.flatMap((h, i) => (byId.has(h.id) ? [{ ...h, artwork: byId.get(h.id)!, frame: FRAMES[i % FRAMES.length] }] : []));
  const cols = useColumnCount();
  if (!hits.length) return null;
  const columns = Array.from({ length: cols }, (_, c) => hits.filter((_, i) => i % cols === c));

  return (
    <div className="wall wall-memes page-bleed mt-10 py-12 md:mt-16 md:py-20">
      <div className="mb-8 flex flex-col items-start gap-3 md:mb-12">
        <HallTitle n={n}>Хіти з-під скла</HallTitle>
        <p className="t-body text-[var(--wall-text-2)]">
          <span className="md:hidden">Торкніться картини — і вона заговорить.</span>
          <span className="hidden md:inline">Наведіть на картину — і вона заговорить.</span>
        </p>
      </div>
      <div className="flex items-start gap-6 lg:gap-8">
        {columns.map((column, c) => (
          <div key={c} className="flex min-w-0 flex-1 flex-col gap-8">
            {column.map((h) => (
              <Hit key={h.id} artwork={h.artwork} caption={h.caption} frame={h.frame} />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-8 flex justify-center">
        <Link to="/create" className="t-strong inline-flex min-h-11 items-center text-[var(--wall-text)] underline-offset-4 hover:underline">
          Зробити свій мем →
        </Link>
      </div>
    </div>
  );
}

function Hit({ artwork, caption, frame }: { artwork: ArtworkSummary; caption: string; frame: Frame }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      onMouseLeave={() => setOpen(false)}
      aria-pressed={open}
      aria-label={`«${artwork.title}», ${artwork.artist.name}. Мем: ${caption}`}
      className={`hit group block w-full text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent ${open ? "is-open" : ""}`}
    >
      <Artwork frame={frame} size="sm">
        <div className="relative w-full">
          <img src={artwork.thumb_url} alt="" crossOrigin="anonymous" loading="lazy" className="block w-full" />
          <span className="hit-caption" aria-hidden>{caption}</span>
        </div>
      </Artwork>
      <div className="wall-label mt-4">
        <div className="wl-who truncate">{artwork.artist.name}</div>
        <div className="hit-what">
          <span className="wl-what hit-title">«{artwork.title}»{artwork.year ? `, ${artwork.year}` : ""}</span>
          <span className="wl-what hit-meaning" aria-hidden>Насправді: {caption.charAt(0).toLowerCase() + caption.slice(1)}</span>
        </div>
        <div className="wl-inv text-right">Інв. № {inventoryNo(artwork.id)}</div>
      </div>
    </button>
  );
}
