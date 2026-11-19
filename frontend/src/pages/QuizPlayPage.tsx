/** One quiz run (ADR 0008): question → answer → reveal with the painting's story → next, until the run ends. */
import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router";
import { api, ApiError } from "../api/client";
import type { QuizGame, QuizQuestion, QuizResult, QuizReveal, QuizRun } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { authEnabled } from "../auth/supabase";
import { Artwork } from "../components/Artwork";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { ErrorMessage, Loading, Page } from "../components/Layout";
import { inventoryNo } from "../components/Museum";
import { plural } from "../plural";
import { bestKey, GAMES } from "../quiz/games";
import { CertificateCrest, CertificateFrame, InkStamp, OrnamentRule, Signature } from "../quiz/Certificate";
import { CloakroomTag, percent, rankName, share } from "../quiz/Museum";

const WRONG = "#7b1e2a"; // the velvet-rope red
const RIGHT = "#2b6a3e"; // the «ПРАВИЛЬНО» stamp green

/** No drag on touch screens: phones tap a painting, then an author. */
const PAIRS_HINT = (
  <>
    <span className="md:hidden">Оберіть картину, потім — її автора.</span>
    <span className="hidden md:inline">Перетягніть автора під його картину.</span>
  </>
);

export function QuizPlayPage() {
  const { game = "" } = useParams();
  const [params] = useSearchParams();
  const { user, ready } = useAuth();
  const [round, setRound] = useState(0);
  if (!(game in GAMES)) return <Navigate to="/quiz" replace />;
  if (!ready) return <Page title={GAMES[game as QuizGame].title}><Loading /></Page>;
  const scope = game === "titles" ? params.get("scope") || "all" : "all";
  // Signing in or out mid-run starts a new run (the backend refuses the old token anyway).
  return <QuizRunView key={`${game}:${scope}:${user?.id ?? "guest"}:${round}`} game={game as QuizGame} scope={scope} onRestart={() => setRound((n) => n + 1)} />;
}

function QuizRunView({ game, scope, onRestart }: { game: QuizGame; scope: string; onRestart: () => void }) {
  const meta = GAMES[game];
  const { user, login } = useAuth();
  const [run, setRun] = useState<QuizRun | null>(null);
  const [question, setQuestion] = useState<QuizQuestion | null>(null);
  const [result, setResult] = useState<QuizResult | null>(null);
  const [showFinal, setShowFinal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null); // the run can't go on
  const [answerError, setAnswerError] = useState<string | null>(null); // this answer didn't arrive: resend it
  const lastAnswer = useRef<Record<string, string> | null>(null);
  const [best, setBest] = useState<number | null>(null);
  const [scopeName, setScopeName] = useState<string | null>(null);
  const [artworks, setArtworks] = useState<number | null>(null); // size of the collection: the base of the museum rank

  useEffect(() => {
    let active = true;
    api.startQuiz(game, scope)
      .then((value) => { if (active) { setRun(value); setQuestion(value.question); } })
      .catch((e: Error) => active && setError(e.message));
    api.quiz().then((info) => {
      if (!active) return;
      setBest(info.best?.[bestKey(game, scope)] ?? null);
      if (scope !== "all") setScopeName(info.title_scopes.find((s) => s.key === scope)?.name ?? null);
      setArtworks(info.artworks); // the rank is always a share of the whole collection
    }).catch(() => undefined);
    return () => { active = false; };
  }, [game, scope]);

  // `retry` resends after a failed request; otherwise new answers wait until the error is dealt with
  // (stops «Пари» from auto-submitting again and again on a dead connection).
  const answer = useCallback(async (value: Record<string, string>, retry = false) => {
    if (!run?.token || busy || result || (answerError && !retry)) return;
    lastAnswer.current = value;
    setBusy(true);
    setError(null);
    setAnswerError(null);
    try {
      const next = await api.answerQuiz(run.token, value);
      setResult(next);
      setRun(next.run);
      if (next.best !== null) setBest(next.best);
      for (const image of next.run.question?.images ?? []) new Image().src = image.image_url; // preload
    } catch (e) {
      // Only an expired/invalid run has to start over; a network blip keeps the streak.
      if (e instanceof ApiError && e.code === "quiz_restart") setError(e.message);
      else setAnswerError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [run, busy, result, answerError]);

  const next = useCallback(() => {
    if (!result) return;
    if (result.finished) setShowFinal(true);
    else {
      setQuestion(result.run.question);
      setResult(null);
    }
  }, [result]);

  // B1 · cloakroom tags: the score on the dark one, the record on the burgundy one.
  const header = (
    <div className="flex items-end gap-3">
      <CloakroomTag value={run?.score ?? 0} label={run?.limit ? `з ${run.limit}` : "рахунок"} />
      {user && <CloakroomTag value={best ?? "—"} label="рекорд" tone="burgundy" />}
    </div>
  );
  const page = (children: ReactNode) => (
    <Page
      title={meta.title}
      subtitle={game === "pairs" ? (!showFinal && !result && !run?.score ? PAIRS_HINT : undefined) : scopeName ? `Картини: ${scopeName}` : undefined}
      back={<Link to="/quiz" className="t-small inline-flex items-center gap-2 text-text-secondary hover:text-accent"><Icon name="arrowLeft" size={16} /> Усі зали</Link>}
      actions={!showFinal && header}
    >
      {children}
    </Page>
  );

  if (error) return page(<ErrorMessage error={error} onRetry={onRestart} />);
  if (!run || !question) return page(<Loading text="Готуємо картини…" />);
  if (showFinal && result?.finished) {
    return page(
      <FinalCard
        game={game} scope={scope} scopeName={scopeName} result={result} signedIn={!!user} artworks={artworks}
        onAgain={onRestart} onLogin={() => void login()}
      />,
    );
  }

  return page(<>
    {answerError && (
      <div className="mb-6">
        <ErrorMessage error={answerError} onRetry={() => lastAnswer.current && void answer(lastAnswer.current, true)} />
      </div>
    )}
    {game === "pairs"
      ? <PairsQuestion key={question.images.map((i) => i.image_url).join()} question={question} result={result} busy={busy} onAnswer={answer} onNext={next} />
      : <SingleQuestion key={question.images[0].image_url} game={game} question={question} result={result} busy={busy} onAnswer={answer} onNext={next} />}
  </>);
}

// ---------- «Хто автор?» and «Назва картини» ----------

function SingleQuestion({ game, question, result, busy, onAnswer, onNext }: {
  game: QuizGame; question: QuizQuestion; result: QuizResult | null; busy: boolean;
  onAnswer: (answer: Record<string, string>) => void; onNext: () => void;
}) {
  const reveal = result?.reveals[0];
  const pick = (key: string) => onAnswer({ answer: key });

  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (!result) {
        const option = question.options[Number(e.key) - 1];
        if (option) pick(option.key);
      } else if (e.key === "Enter" || e.key === "ArrowRight") onNext();
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  });

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-14">
      <Artwork
        src={question.images[0].image_url}
        alt="Картина з вікторини"
        size="lg"
        crack={reveal && !reveal.correct ? "animate" : null}
      />
      <div>
        <h2 className="t-h2">{GAMES[game].prompt}</h2>
        {/* Q3 · typed index cards from the museum catalogue; the right one gets a «ВІРНО» stamp. */}
        <div className="mt-6 space-y-4" role="group" aria-label="Картки каталогу: варіанти відповіді">
          {question.options.map((option, index) => {
            const state = !reveal ? "idle" : option.key === reveal.right ? "right" : option.key === reveal.chosen ? "wrong" : "other";
            return (
              <button
                key={option.key}
                type="button"
                disabled={busy || !!reveal}
                onClick={() => pick(option.key)}
                className={`catalogue-card !flex-wrap max-md:!grid max-md:!grid-cols-[22px_minmax(0,1fr)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent ${state === "other" ? "faded" : ""} ${state === "wrong" ? "struck" : ""}`}
              >
                <span className="card-no">{index + 1}</span>
                <span className="card-text min-w-0 flex-1 break-words">{option.label}</span>
                {state === "right" && <span className="stamp stamp-right !static ml-auto !translate-y-0 !animate-none max-md:col-start-2 max-md:!ml-0 max-md:justify-self-start">ПРАВИЛЬНО</span>}
                {state === "wrong" && <span className="stamp stamp-wrong !static ml-auto !translate-y-0 !animate-none max-md:col-start-2 max-md:!ml-0 max-md:justify-self-start">НЕПРАВИЛЬНО</span>}
                <span className="card-hole" aria-hidden />
              </button>
            );
          })}
        </div>
        {reveal && result && <RevealCard reveal={reveal} result={result} onNext={onNext} />}
      </div>
    </div>
  );
}

/** After an answer: the painting's museum label, with one reviewed fact. */
function RevealCard({ reveal, result, onNext }: { reveal: QuizReveal; result: QuizResult; onNext: () => void }) {
  const a = reveal.artwork;
  return (
    <div className="mt-8" role="status" aria-label={reveal.correct ? "Правильно" : "Неправильно"}>
      <div className={`wall-label verdict ${reveal.correct ? "verdict-right" : "verdict-wrong"} !p-5`}>
        <Link to={`/artists/${a.artist.slug}`} className="wl-who hover:text-accent">{a.artist.name} →</Link>
        <div className="wl-what !text-[22px]">«{a.title}»{a.year ? `, ${a.year}` : ""}</div>
        {reveal.fact && <p className="t-small mt-3">{reveal.fact}</p>}
        <div className="wl-inv">Інв. № {inventoryNo(a.id)}</div>
      </div>
      <NextButton result={result} onNext={onNext} />
    </div>
  );
}

function NextButton({ result, onNext }: { result: QuizResult; onNext: () => void }) {
  return (
    <Button autoFocus className="mt-5 flex min-h-11 w-full items-center justify-center gap-2 md:w-auto" onClick={onNext}>
      {result.finished ? "Підсумки" : "Далі"} <Icon name="arrowRight" size={18} />
    </Button>
  );
}

// ---------- «Пари» ----------


function PairsQuestion({ question, result, busy, onAnswer, onNext }: {
  question: QuizQuestion; result: QuizResult | null; busy: boolean;
  onAnswer: (answer: Record<string, string>) => void; onNext: () => void;
}) {
  const [pairs, setPairs] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(question.images[0].key);
  const [over, setOver] = useState<string | null>(null); // drop target under the dragged label: an image key or "tray"
  const labels = Object.fromEntries(question.options.map((o) => [o.key, o.label]));
  const revealed = (key: string) => result?.reveals.find((r) => r.image_key === key);
  const complete = question.images.every((i) => pairs[i.key]);

  // No «check» button: once the third label is hung the round is checked, after a beat to see it hang.
  // Moving a label within that beat restarts it.
  useEffect(() => {
    if (!complete || result || busy) return;
    const timer = window.setTimeout(() => onAnswer(pairs), 450);
    return () => window.clearTimeout(timer);
  }, [complete, result, busy, pairs, onAnswer]);

  /** Hang a label under a painting. A label already there swaps places with it, or goes back to the tray. */
  const place = (option: string, image: string) => {
    if (busy || result) return;
    const from = Object.keys(pairs).find((k) => pairs[k] === option);
    const displaced = pairs[image];
    const nextPairs = Object.fromEntries(Object.entries(pairs).filter(([k, o]) => o !== option && k !== image));
    nextPairs[image] = option;
    if (from && displaced && from !== image) nextPairs[from] = displaced;
    setPairs(nextPairs);
    setSelected(question.images.find((i) => !nextPairs[i.key])?.key ?? null);
  };
  const assign = (option: string) => {
    const target = selected ?? question.images.find((i) => !pairs[i.key])?.key;
    if (target) place(option, target);
  };
  const unassign = (image: string) => {
    if (busy || result) return;
    setPairs(Object.fromEntries(Object.entries(pairs).filter(([k]) => k !== image)));
    setSelected(image);
  };

  // drag and drop: labels carry their option key; paintings and the tray take them
  const drag = (option: string) => (e: DragEvent) => {
    e.dataTransfer.setData("text/plain", option);
    e.dataTransfer.effectAllowed = "move";
  };
  const target = (key: string, onDrop: (option: string) => void) => result ? {} : {
    onDragOver: (e: DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (over !== key) setOver(key); },
    onDragLeave: (e: DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null); },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setOver(null);
      const option = e.dataTransfer.getData("text/plain");
      if (option in labels) onDrop(option);
    },
  };

  return (
    <div>
      {/* P1 · blank wall labels from the curator's tray, hung on hooks under the paintings */}
      <div className="grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-6 lg:gap-8">
        {question.images.map((image, index) => {
          const reveal = revealed(image.key);
          const chosen = pairs[image.key];
          const active = !result && (selected === image.key || over === image.key);
          return (
            <div key={image.key} className="flex min-w-0 flex-col items-center break-words" {...target(image.key, (option) => place(option, image.key))}>
              <button
                type="button"
                aria-label={`Картина ${index + 1}`}
                aria-pressed={selected === image.key}
                disabled={busy || !!result}
                onClick={() => setSelected(image.key)}
                className="pairs-painting block text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
              >
                <Artwork src={image.image_url} alt={`Картина ${index + 1} з вікторини`} aspect="4/5" selected={active}
                  crack={reveal && !reveal.correct ? "animate" : null} />
              </button>
              <span className="label-hook mt-3" aria-hidden />
              <div className="pairs-painting">
                {reveal ? (
                  <div className={`wall-label verdict ${reveal.correct ? "verdict-right" : "verdict-wrong"}`}>
                    <span className={`stamp ${reveal.correct ? "stamp-right" : "stamp-wrong"}`}>{reveal.correct ? "ПРАВИЛЬНО" : "ПОМИЛКА"}</span>
                    {!reveal.correct && <div className="wl-who line-through" style={{ color: WRONG }}>{labels[chosen] ?? "—"}</div>}
                    <div className="wl-who" style={reveal.correct ? { color: RIGHT } : undefined}>{reveal.correct ? "✓ " : "→ "}{labels[reveal.right]}</div>
                    <div className="wl-what">«{reveal.artwork.title}»{reveal.artwork.year ? `, ${reveal.artwork.year}` : ""}</div>
                    <div className="wl-inv">Інв. № {inventoryNo(reveal.artwork.id)}</div>
                  </div>
                ) : chosen ? (
                  <DragLabel label={labels[chosen]} ariaLabel={`Зняти етикетку: ${labels[chosen]}`} onDragStart={drag(chosen)} onClick={() => unassign(image.key)} className="w-full" title="Перетягніть або натисніть, щоб зняти" />
                ) : (
                  <button
                    type="button"
                    onClick={() => setSelected(image.key)}
                    className={`flex min-h-[46px] w-full items-center justify-center border-2 border-dashed px-4 py-2 text-center transition t-small ${active ? "border-accent text-accent" : "border-line text-text-secondary"}`}
                  >
                    {active ? "Автор ↓" : "?"}
                  </button>
                )}
              </div>
              {/* phones: no drag on touch, and the tray is far below, so the free labels come up under the chosen painting */}
              {!result && selected === image.key && (
                <div className="label-tray mt-4 grid w-full gap-3 rounded-card p-4 md:hidden" role="group" aria-label={`Автори для картини ${index + 1}`}>
                  {question.options.filter((o) => !Object.values(pairs).includes(o.key)).map((option) => (
                    <DragLabel key={option.key} label={option.label} onClick={() => assign(option.key)} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!result && (
        <div
          className={`label-tray mt-8 hidden flex-wrap items-center justify-center gap-4 rounded-card px-6 py-4 md:flex ${over === "tray" ? "drop-over" : ""}`}
          {...target("tray", (option) => {
            const image = Object.keys(pairs).find((k) => pairs[k] === option);
            if (image) unassign(image);
          })}
        >
          {question.options.map((option) => {
            const used = Object.values(pairs).includes(option.key);
            return (
              <DragLabel key={option.key} label={option.label} onDragStart={drag(option.key)} onClick={() => assign(option.key)} className={used ? "invisible" : ""} />
            );
          })}
        </div>
      )}
      {result && (
        <div className="mt-8 flex flex-col items-stretch gap-4 rounded-card bg-muted p-5 md:flex-row md:items-center md:gap-6" role="status">
          <div className="flex-1">
            <div className="t-label" style={{ color: result.correct ? RIGHT : WRONG }}>
              {result.correct ? "Усе правильно!" : "Є помилка"}
            </div>
            {result.reveals[0]?.fact && <p className="t-small mt-2">{result.reveals.find((r) => !r.correct)?.fact || result.reveals[0].fact}</p>}
          </div>
          <NextButton result={result} onNext={onNext} />
        </div>
      )}
    </div>
  );
}

/** A wall label you can drag, or click (Enter/Space) instead. A div, not a button: Firefox never starts a drag from a button. */
function DragLabel({ label, ariaLabel, onDragStart, onClick, className = "", title }: {
  label: string; ariaLabel?: string; onDragStart?: (e: DragEvent) => void; onClick: () => void; className?: string; title?: string;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={!!onDragStart}
      aria-label={ariaLabel}
      title={title}
      onDragStart={onDragStart}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className={`pair-label wall-label min-h-11 min-w-0 break-words text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent ${className}`}
    >
      <span className="wl-who">{label}</span>
    </div>
  );
}

// ---------- the end of a run ----------

const ENDINGS = {
  mistake: { label: "Гру завершено", text: "" },
  complete: { label: "Колекцію пройдено!", text: "Ви впізнали всю колекцію!" },
  guest_limit: { label: "Гостьову версію пройдено", text: "Жодної помилки!" },
} as const;

/** R1 · a museum certificate with a rank and a wax seal; guests get it stamped «ТИМЧАСОВЕ». */
function FinalCard({ game, scope, scopeName, result, signedIn, artworks, onAgain, onLogin }: {
  game: QuizGame; scope: string; scopeName: string | null; result: QuizResult; signedIn: boolean; artworks: number | null; onAgain: () => void; onLogin: () => void;
}) {
  const score = result.run.score;
  // Finishing one artist's works is not finishing the collection, so «complete» only counts on the whole one.
  const finished = scope === "all" ? result.finished : null;
  // Without the collection size (quiz info failed to load) the share is unknown: no rank rather than a wrong one.
  const part = artworks !== null ? share(game, score, artworks, finished) : finished === "complete" ? 1 : null;
  const ending = ENDINGS[result.finished!];
  const unit = game === "pairs"
    ? `${plural(score, "раунд", "раунди", "раундів")} без помилки`
    : `${plural(score, "картина впізнана", "картини впізнано", "картин впізнано")}`;
  const guest = !signedIn && authEnabled;
  const date = new Date().toLocaleDateString("uk-UA", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[660px] flex-col items-center lg:max-w-[980px]">
      <CertificateFrame>
        {guest && <span className="temp-stamp max-md:!static max-md:mb-6 max-md:inline-block max-md:!transform-none max-md:!text-xs max-md:!tracking-normal" aria-label="Тимчасове посвідчення">ТИМЧАСОВЕ</span>}

        {/* Header: spans both columns on a laptop */}
        <div className="lg:col-span-2">
          <CertificateCrest />
          <h2 className="mt-5 break-words font-heading text-4xl md:text-[60px] font-semibold italic leading-none lg:mt-3 lg:text-[64px]">Посвідчення</h2>
          <OrnamentRule className="mx-auto mt-4 h-4 w-full max-w-[240px] text-accent" />
          <p className="t-body mt-4 text-text-secondary">
            засвідчує, що відвідувач пройшов залу <strong className="font-heading text-[22px] italic text-text">«{GAMES[game].title}»</strong>
            {scopeName && <> · {scopeName}</>}
          </p>
        </div>

        {/* The score in a medallion (left on a laptop); lining figures, so a 1 never reads as a Roman numeral. */}
        <div className="mt-10 lg:mt-8">
          <div className="medallion">
            <span className="font-heading text-[92px] font-semibold leading-none [font-variant-numeric:lining-nums]">{score}</span>
          </div>
          <div className="t-body mt-5 text-text-secondary">{unit}</div>
        </div>

        {/* The rank (right on a laptop) */}
        <div className="mt-6 lg:mt-8">
          {part !== null && <>
          <div className="t-label">Звання</div>
          {/* The rules sit on the rank's own row, so they line up with the middle of the text, not of the label above it. */}
          <div className="mt-1 flex min-w-0 items-center justify-center gap-2 md:gap-4">
            <span className="hidden h-px w-14 shrink-0 bg-accent-soft md:block lg:w-10" />
            <div className="min-w-0 break-words font-heading text-3xl md:text-[40px] font-semibold italic leading-tight lg:text-[46px]">{rankName(part)}</div>
            <span className="hidden h-px w-14 shrink-0 bg-accent-soft md:block lg:w-10" />
          </div>
          <p className="t-small mt-1 text-text-secondary">впізнано {percent(part)} колекції</p>
          </>}
          {result.new_record && <p className="t-label mt-3">Новий рекорд!</p>}
          {signedIn && !result.new_record && !!result.best && (
            <p className="t-small mt-3 text-text-secondary">Ваш рекорд: <strong className="text-text">{result.best}</strong></p>
          )}
          {ending.text && <p className="t-small mx-auto mt-3 max-w-[420px] text-text-secondary">{ending.text}</p>}
        </div>

        {/* Footer: spans both columns; the right gap is where the stamp sits */}
        <div className="mt-8 flex flex-col items-center justify-between gap-6 text-center md:min-h-[150px] md:flex-row md:items-end md:gap-4 md:px-4 md:text-left lg:col-span-2 lg:mt-6">
          <div>
            <div className="t-caption text-text-secondary">Видано</div>
            <div className="t-strong">{date}</div>
          </div>
          <Signature title="Директор музею" />
          <div className="hidden w-[150px] shrink-0 md:block" aria-hidden />
        </div>
        <InkStamp className="max-md:!static max-md:mx-auto max-md:mt-6 max-md:!h-24 max-md:!w-24" />
      </CertificateFrame>
      {guest && (
        <div className="mt-12 w-full rounded-card bg-muted p-5 text-center">
          <p className="t-body">Увійдіть, щоб зберегти звання.</p>
          <Button variant="secondary" className="mt-4" onClick={onLogin}>Увійти з Google</Button>
        </div>
      )}
      <div className={`flex w-full flex-col gap-3 md:w-auto md:flex-row ${guest ? "mt-6" : "mt-12"}`}>
        <Button onClick={onAgain}>Зіграти ще</Button>
        <Link to="/quiz" className="flex min-h-11 items-center justify-center rounded-control bg-muted px-6 py-3 text-[15px] font-semibold leading-[1.2] transition hover:brightness-95">Усі зали</Link>
      </div>
    </div>
  );
}
