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
    <section className="rounded-card border border-line bg-surface p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="t-label">Редактор підпису</div>
        {blocks.length > 1 && (
          <div className="flex gap-2">
            {blocks.map((_, i) => (
              <button key={i} onClick={() => setActive(i)} className={`t-caption ${i === active ? "text-accent" : "text-text-secondary"}`}>
                Текст {i + 1}
              </button>
            ))}
            <button className="t-caption text-text-secondary" onClick={() => removeBlock(active)}>
              Видалити
            </button>
          </div>
        )}
      </div>

      <Input value={b.text} placeholder={placeholder} maxLength={200} onChange={(e) => set({ text: e.target.value })} />
      {hint && <div className="t-small mt-3 text-text-secondary">{hint}</div>}

      <Row label="Шрифт">
        <select
          value={b.font}
          onChange={(e) => set({ font: e.target.value })}
          className="h-11 w-56 rounded-control border border-line bg-muted px-3"
          style={{ fontFamily: b.font }}
        >
          {MEME_FONTS.map((f) => (
            <option key={f.name} value={f.name} style={{ fontFamily: f.name }}>
              {f.name}
            </option>
          ))}
        </select>
      </Row>

      <Row label="Розмір">
        <input type="range" min={16} max={80} value={b.size} onChange={(e) => set({ size: +e.target.value })} className="w-56 accent-accent" />
        <span className="t-small w-12 text-right">{b.size} px</span>
      </Row>

      <Row label="Колір">
        {MEME_COLORS.map((c) => (
          <button
            key={c}
            aria-label={c}
            onClick={() => set({ color: c })}
            className={`h-8 w-8 rounded-full border ${b.color === c ? "ring-2 ring-accent ring-offset-2" : "border-line"}`}
            style={{ background: c }}
          />
        ))}
      </Row>

      <Row label="Обведення">
        <button
          role="switch"
          aria-checked={b.outline}
          onClick={() => set({ outline: !b.outline })}
          className={`relative h-6 w-11 rounded-full transition ${b.outline ? "bg-accent" : "bg-line"}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${b.outline ? "left-5" : "left-0.5"}`} />
        </button>
      </Row>

      <Row label="Розташування">
        <div className="flex rounded-control bg-muted p-1">
          {(Object.keys(POSITION_LABELS) as Position[]).map((p) => (
            <button
              key={p}
              // picking a preset resets manual drag position
              onClick={() => set({ position: p, x: null, y: null })}
              className={`rounded-control px-4 py-1.5 text-sm ${b.position === p && b.y === null ? "bg-surface shadow-sm" : "text-text-secondary"}`}
            >
              {POSITION_LABELS[p]}
            </button>
          ))}
        </div>
      </Row>

      {blocks.length < MAX_BLOCKS && (
        <button onClick={addBlock} className="mt-6 rounded-control bg-muted px-5 py-3 text-[15px] font-semibold">
          + Додати ще один текст
        </button>
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-5 flex items-center justify-between gap-4">
      <span className="t-small text-text-secondary">{label}</span>
      <div className="flex items-center gap-3">{children}</div>
    </div>
  );
}
