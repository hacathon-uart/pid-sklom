import { useEffect, useRef, useState } from "react";
import { getGuest, type Guest } from "../api/client";
import { Icon } from "../components/Icon";
import { useAuth } from "./AuthContext";
import { authEnabled } from "./supabase";

export function GuestAllowance() {
  const { user, ready, login } = useAuth();
  const [guest, setGuest] = useState<Guest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const ticket = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!authEnabled || !ready || user) return;
    let active = true;
    void getGuest().then((value) => {
      if (active) { setGuest({ ...value }); setError(null); }
    }).catch((failure: Error) => { if (active) setError(failure.message); });
    const update = (event: Event) => {
      setGuest((event as CustomEvent<Guest>).detail);
      setError(null);
    };
    window.addEventListener("pidsklom:allowance", update);
    return () => { active = false; window.removeEventListener("pidsklom:allowance", update); };
  }, [ready, user, attempt]);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (ticket.current && event.target instanceof Node && !ticket.current.contains(event.target)) {
        ticket.current.open = false;
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && ticket.current?.open) {
        ticket.current.open = false;
        ticket.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  if (!authEnabled || !ready || user || (!error && !guest?.enabled)) return null;
  const generations = guest?.remaining;
  const exports = guest?.exports_remaining;
  const count = (value: number | null | undefined) => typeof value === "number" ? `${value}/3` : "—";
  return (
    <details ref={ticket} className="relative shrink-0 self-start text-left">
      <summary
        aria-label={`Гостьовий квиток. Залишилось: ШІ ${count(generations)}, PNG ${count(exports)}`}
        className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-control border border-line bg-muted px-4 py-2.5 text-left marker:content-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
      >
        <Icon name="bookmark" size={26} />
        <span className="border-l border-dashed border-accent-soft pl-3">
          <span className="t-label block text-[10px]">Гостьовий квиток</span>
          <span className="t-small mt-1 flex items-center gap-3" aria-live="polite" aria-atomic>
            {error ? <span>Перевірити ліміти</span> : <>
              <span>ШІ <strong>{count(generations)}</strong></span>
              <span className="flex items-center gap-1"><Icon name="download" size={15} /><strong>PNG {count(exports)}</strong></span>
            </>}
          </span>
        </span>
        <Icon name="chevronDown" size={13} />
      </summary>
      <div className="fixed inset-x-4 bottom-[calc(var(--app-bottom-clearance)+8px)] z-40 max-h-[calc(100dvh-var(--app-bottom-clearance)-32px)] overflow-y-auto rounded-card border border-line bg-surface p-5 shadow-lg md:absolute md:inset-x-auto md:bottom-auto md:left-0 md:top-full md:mt-3 md:w-80 md:max-h-[min(80dvh,600px)]">
        <button type="button" className="t-small float-right rounded-control px-2 py-1 text-accent focus-visible:outline-2 focus-visible:outline-accent" onClick={() => { if (ticket.current) ticket.current.open = false; ticket.current?.querySelector("summary")?.focus(); }}>Закрити</button>
        <p className="t-label">Ваш гостьовий квиток</p>
        <p className="mt-2 font-heading text-[28px] leading-tight">Спробуйте, створіть, заберіть.</p>
        {error ? <div role="alert" className="t-small mt-4">
          <p>{error}</p>
          <button type="button" className="t-strong mt-3 text-accent" onClick={() => setAttempt((value) => value + 1)}>Спробувати ще раз</button>
        </div> : <>
          <div className="mt-5 space-y-4">
            <AllowanceRow label="ШІ-генерації" remaining={generations} />
            <AllowanceRow label="Унікальні PNG" remaining={exports} />
          </div>
          <div className="t-caption mt-5 space-y-2 border-t border-line pt-4 text-text-secondary">
            <p>Два окремі ліміти, без щоденного поновлення. Підбір картини або набір ШІ-підписів — одна генерація.</p>
            {typeof exports === "number"
              ? <p>Новий PNG для завантаження чи поширення — один експорт. Зміна тексту, картини або оформлення створює новий PNG; повтор незміненого — безкоштовний.</p>
              : <p>Гостьовий ліміт PNG ще не ввімкнено.</p>}
            <p>Редагування вручну й поширення посилань — без обмежень. Збереження до «Моїх мемів» потребує входу й не витрачає ці ліміти.</p>
          </div>
        </>}
        <button type="button" className="t-strong mt-4 w-full rounded-control bg-accent px-3 py-3 text-white" onClick={() => void login()}>
          Продовжити через Google
        </button>
        <p className="t-caption mt-2 text-center text-text-secondary">Увійдіть, щоб зняти гостьові ліміти.</p>
      </div>
    </details>
  );
}

function AllowanceRow({ label, remaining }: { label: string; remaining: number | null | undefined }) {
  return (
    <div className="flex items-center gap-3">
      <span className="t-small flex-1">{label}</span>
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((index) => <span key={index} className={`h-1.5 w-1.5 rounded-full ${typeof remaining === "number" && index < remaining ? "bg-accent" : "bg-accent/15"}`} />)}
      </span>
      <strong className="t-small w-9 text-right">{typeof remaining === "number" ? `${remaining}/3` : "—"}</strong>
    </div>
  );
}
