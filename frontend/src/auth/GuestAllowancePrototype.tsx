// Throwaway: three guest-counter designs on the existing editor via ?prototype=guest-allowance&variant=A.
// Verdict: A, the header ticket; keep it closer to the content. Separate AI/PNG limits, including PNG sharing.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { Icon } from "../components/Icon";

type Preview = {
  variant: string;
  generations: number;
  downloads: number;
};
const PreviewContext = createContext<Preview | null>(null);
const variants = [
  { key: "A", name: "Квиток у заголовку" },
  { key: "B", name: "Штамп у навігації" },
  { key: "C", name: "Лічильники біля дій" },
];

function Dots({ remaining }: { remaining: number }) {
  return (
    <span className="flex gap-1" aria-hidden>
      {[0, 1, 2].map((index) => (
        <span key={index} className={`h-1.5 w-1.5 rounded-full ${index < remaining ? "bg-accent" : "bg-accent/15"}`} />
      ))}
    </span>
  );
}

function Details({ generations, downloads }: Preview) {
  return (
    <div className="w-72 rounded-card border border-line bg-surface p-5 text-left shadow-lg">
      <p className="t-label">Ваш гостьовий квиток</p>
      <p className="mt-2 font-heading text-[28px] leading-tight">Спробуйте, створіть, заберіть.</p>
      <div className="mt-5 space-y-4">
        <div className="flex items-center gap-3">
          <Icon name="pencil" size={20} />
          <span className="t-small flex-1">ШІ-генерації</span>
          <Dots remaining={generations} />
          <strong className="t-small w-9 text-right">{generations}/3</strong>
        </div>
        <div className="flex items-center gap-3">
          <Icon name="download" size={20} />
          <span className="t-small flex-1">Унікальні PNG</span>
          <Dots remaining={downloads} />
          <strong className="t-small w-9 text-right">{downloads}/3</strong>
        </div>
      </div>
      <p className="t-caption mt-5 border-t border-line pt-4 text-text-secondary">
        Це два окремі ліміти. Повторне завантаження незміненого мему — безкоштовне.
        Редагуйте без обмежень.
      </p>
      <button type="button" className="t-strong mt-4 w-full rounded-control bg-accent px-3 py-3 text-white" disabled>
        Продовжити через Google
      </button>
      <p className="t-caption mt-2 text-center text-text-secondary">У макеті вхід не запускається.</p>
    </div>
  );
}

export function PrototypeAllowanceActions() {
  const preview = useContext(PreviewContext);
  const [open, setOpen] = useState(false);
  if (!preview || preview.variant !== "C") return null;
  return (
    <div className="relative ml-auto">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-11 items-center gap-3 rounded-control border border-line bg-surface px-3 text-accent"
        aria-expanded={open}
        aria-label="Гостьові можливості"
      >
        <span className="flex items-center gap-1.5">
          <span className="t-caption font-bold">ШІ</span>
          <strong className="t-small">{preview.generations}<span className="font-normal text-text-secondary">/3</span></strong>
        </span>
        <span className="h-5 border-l border-line" />
        <span className="flex items-center gap-1.5">
          <Icon name="download" size={17} />
          <strong className="t-small">{preview.downloads}<span className="font-normal text-text-secondary">/3</span></strong>
        </span>
        <Icon name="chevronDown" size={13} />
      </button>
      {open && <div className="absolute right-0 top-full z-30 mt-3"><Details {...preview} /></div>}
    </div>
  );
}

function HeaderTicket(preview: Preview) {
  const [open, setOpen] = useState(false);
  return (
    <div className="absolute right-16 top-9 z-30">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-4 rounded-control border border-line bg-muted px-5 py-3 text-left"
      >
        <Icon name="bookmark" size={28} />
        <span className="border-l border-dashed border-accent-soft pl-4">
          <span className="t-label block text-[10px]">Гостьовий квиток</span>
          <span className="t-small mt-1 flex items-center gap-3">
            <span>ШІ <strong>{preview.generations}/3</strong></span>
            <span className="flex items-center gap-1"><Icon name="download" size={15} /><strong>{preview.downloads}/3</strong></span>
          </span>
        </span>
        <Icon name="chevronDown" size={14} />
      </button>
      {open && <div className="absolute right-0 top-full mt-3"><Details {...preview} /></div>}
    </div>
  );
}

function SidebarStamp(preview: Preview) {
  const [open, setOpen] = useState(false);
  return (
    <div className="fixed bottom-28 left-2 z-30">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-[72px] flex-col items-center gap-2 rounded-card border border-accent-soft bg-bg py-3"
      >
        <Icon name="bookmark" size={24} />
        <span className="text-[9px] font-bold uppercase tracking-wider text-accent">Гість</span>
        <span className="flex w-full items-center justify-between px-3">
          <span className="text-[10px] font-semibold">ШІ</span>
          <Dots remaining={preview.generations} />
        </span>
        <span className="flex w-full items-center justify-between px-3">
          <Icon name="download" size={13} />
          <Dots remaining={preview.downloads} />
        </span>
      </button>
      {open && <div className="absolute bottom-0 left-full ml-4"><Details {...preview} /></div>}
    </div>
  );
}

export function GuestAllowancePrototype({ children }: { children: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const selected = Math.max(0, variants.findIndex((item) => item.key === params.get("variant")));
  const [generations, setGenerations] = useState(3);
  const [downloads, setDownloads] = useState(3);
  const preview = { variant: variants[selected].key, generations, downloads };
  const cycle = (direction: number) => {
    const next = new URLSearchParams(params);
    next.set("variant", variants[(selected + direction + variants.length) % variants.length].key);
    setParams(next, { replace: true });
  };
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest("input,textarea,[contenteditable]")) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        cycle(event.key === "ArrowLeft" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  });
  useEffect(() => {
    console.info("[guest-allowance-prototype]", preview);
  }, [preview.variant, generations, downloads]);
  return (
    <PreviewContext value={preview}>
      {children}
      {preview.variant === "A" && <HeaderTicket {...preview} />}
      {preview.variant === "B" && <SidebarStamp {...preview} />}
      {import.meta.env.DEV && (
        <div className="fixed bottom-5 left-[calc(50%_+_44px)] z-50 flex -translate-x-1/2 flex-wrap items-center justify-center gap-3 rounded-card bg-text px-4 py-3 text-bg shadow-xl">
          <span className="t-caption rounded border border-bg/30 px-2 py-1">МАКЕТ</span>
          <button type="button" aria-label="Попередній варіант" onClick={() => cycle(-1)}><Icon name="arrowLeft" size={20} /></button>
          <span className="t-small min-w-52 text-center">{variants[selected].key} · {variants[selected].name}</span>
          <button type="button" aria-label="Наступний варіант" onClick={() => cycle(1)}><Icon name="arrowRight" size={20} /></button>
          <span className="h-6 border-l border-bg/25" />
          <button type="button" className="t-caption rounded-control border border-bg/30 px-2 py-2" onClick={() => setGenerations(Math.max(0, generations - 1))}>ШІ −1</button>
          <button type="button" className="t-caption rounded-control border border-bg/30 px-2 py-2" onClick={() => setDownloads(Math.max(0, downloads - 1))}>PNG −1</button>
          <button type="button" className="t-caption underline" onClick={() => { setGenerations(3); setDownloads(3); }}>Скинути</button>
          <span className="t-caption w-full text-center opacity-70">Лише демонстраційний стан: ШІ {generations}/3 · PNG {downloads}/3. Серверні ліміти не змінюються.</span>
        </div>
      )}
    </PreviewContext>
  );
}
