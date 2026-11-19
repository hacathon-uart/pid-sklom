/** «Редактор підпису» panel (screen 3b / 3d). Owner: B — T15, T29. */
import type { ReactNode } from "react";
import type { Position } from "../api/types";
import { Input } from "../components/Input";
import { MAX_BLOCKS, MEME_COLORS, MEME_FONTS, POSITION_LABELS } from "./model";
import type { MemeDraft } from "./useMemeDraft";

export function CaptionControls({
  draft,
  placeholder = "Напишіть свій підпис…",
  hint,
}: {
  draft: MemeDraft;
  placeholder?: string;
  hint?: ReactNode; // e.g. «Немає ідей? Запропонувати підписи від ШІ →» on 3d
}) {
  const { blocks, active, setActive, update, addBlock, removeBlock } = draft;
  const b = blocks[active] ?? blocks[0];
  const set = (patch: Parameters<typeof update>[1]) => update(active, patch);

  return (
    <section className="min-w-0 rounded-card border border-line bg-surface p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="t-label">Редактор підпису</div>
        {blocks.length > 1 && (
          <div className="flex gap-2">
            {blocks.map((_, i) => (
              <button key={i} onClick={() => setActive(i)} aria-pressed={i === active} className={`t-caption min-h-11 rounded-control px-2 focus-visible:outline-2 focus-visible:outline-accent ${i === active ? "text-accent" : "text-text-secondary"}`}>
                Текст {i + 1}
              </button>
            ))}
            <button className="t-caption min-h-11 rounded-control px-2 text-text-secondary focus-visible:outline-2 focus-visible:outline-accent" onClick={() => removeBlock(active)}>
              Видалити
            </button>
          </div>
        )}
      </div>

      <Input aria-label="Текст підпису" value={b.text} placeholder={placeholder} maxLength={200} onChange={(e) => set({ text: e.target.value })} />
      {hint && <div className="t-small mt-3 text-text-secondary">{hint}</div>}

      <Row label="Шрифт" htmlFor="caption-font">
        <select
          id="caption-font"
          value={b.font}
          onChange={(e) => set({ font: e.target.value })}
          className="h-11 w-full min-w-0 rounded-control border border-line bg-muted px-3 focus-visible:outline-2 focus-visible:outline-accent sm:w-56"
          style={{ fontFamily: b.font }}
        >
          {MEME_FONTS.map((f) => (
            <option key={f.name} value={f.name} style={{ fontFamily: f.name }}>
              {f.name}
            </option>
          ))}
        </select>
      </Row>

      <Row label="Розмір" htmlFor="caption-size">
        <input id="caption-size" type="range" min={16} max={80} value={b.size} onChange={(e) => set({ size: +e.target.value })} className="min-w-0 flex-1 accent-accent sm:w-56" />
        <span className="t-small w-12 text-right">{b.size} px</span>
      </Row>

      <Row label="Колір">
        {MEME_COLORS.map((c) => (
          <button
            key={c}
            aria-label={`Колір ${c}`}
            aria-pressed={b.color === c}
            onClick={() => set({ color: c })}
            className={`h-11 w-11 rounded-full border p-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${b.color === c ? "ring-2 ring-accent ring-offset-2" : "border-line"}`}
            style={{ background: c }}
          />
        ))}
      </Row>

      <Row label="Обведення">
        <button
          role="switch"
          aria-label="Обведення підпису"
          aria-checked={b.outline}
          onClick={() => set({ outline: !b.outline })}
          className={`relative h-11 w-11 shrink-0 rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${b.outline ? "bg-accent" : "bg-line"}`}
        >
          <span className={`absolute top-3 h-5 w-5 rounded-full bg-white transition ${b.outline ? "left-5" : "left-0.5"}`} />
        </button>
      </Row>

      <Row label="Розташування">
        <div className="flex w-full min-w-0 flex-wrap rounded-control bg-muted p-1 sm:w-auto">
          {(Object.keys(POSITION_LABELS) as Position[]).map((p) => (
            <button
              key={p}
              // picking a preset resets manual drag position
              onClick={() => set({ position: p, x: null, y: null })}
              aria-pressed={b.position === p && b.y === null}
              className={`min-h-11 min-w-0 max-w-full flex-[1_0_auto] rounded-control px-2 py-1.5 text-sm [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-accent sm:px-4 ${b.position === p && b.y === null ? "bg-surface shadow-sm" : "text-text-secondary"}`}
            >
              {POSITION_LABELS[p]}
            </button>
          ))}
        </div>
      </Row>

      {blocks.length < MAX_BLOCKS && (
        <button onClick={addBlock} className="mt-6 min-h-11 rounded-control bg-muted px-5 py-3 text-[15px] font-semibold focus-visible:outline-2 focus-visible:outline-accent">
          + Додати текст
        </button>
      )}
    </section>
  );
}

function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="mt-5 flex min-w-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      {htmlFor ? <label htmlFor={htmlFor} className="t-small text-text-secondary">{label}</label> : <span className="t-small text-text-secondary">{label}</span>}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3 sm:flex-initial sm:justify-end">{children}</div>
    </div>
  );
}
