/** One quiz run (ADR 0008): question → answer → reveal with the painting's story → next, until the run ends. */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router";
import { api, ApiError } from "../api/client";
import type { QuizGame, QuizQuestion, QuizResult, QuizReveal, QuizRun } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { authEnabled } from "../auth/supabase";
import { Artwork } from "../components/Artwork";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { ErrorMessage, Loading, Page } from "../components/Layout";
import { plural } from "../plural";
import { bestKey, GAMES } from "../quiz/games";

const WRONG = "#7b1e2a"; // the velvet-rope red

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
  const [error, setError] = useState<string | null>(null);
  const [best, setBest] = useState<number | null>(null);
  const [scopeName, setScopeName] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.startQuiz(game, scope)
      .then((value) => { if (active) { setRun(value); setQuestion(value.question); } })
      .catch((e: Error) => active && setError(e.message));
    api.quiz().then((info) => {
      if (!active) return;
      setBest(info.best?.[bestKey(game, scope)] ?? null);
      if (scope !== "all") setScopeName(info.title_scopes.find((s) => s.key === scope)?.name ?? null);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [game, scope]);

  const answer = useCallback(async (value: Record<string, string>) => {
    if (!run?.token || busy || result) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.answerQuiz(run.token, value);
      setResult(next);
      setRun(next.run);
      if (next.best !== null) setBest(next.best);
      for (const image of next.run.question?.images ?? []) new Image().src = image.image_url; // preload
    } catch (e) {
      setError(e instanceof ApiError && e.code === "quiz_restart" ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [run, busy, result]);

  const next = useCallback(() => {
    if (!result) return;
    if (result.finished) setShowFinal(true);
    else {
      setQuestion(result.run.question);
      setResult(null);
    }
  }, [result]);

  const header = (
    <div className="flex items-center gap-8">
      <Stat label="Рахунок" value={run?.limit ? `${run.score} / ${run.limit}` : run?.score ?? 0} />
      {user && <Stat label="Рекорд" value={best ?? "—"} />}
    </div>
  );
  const page = (children: ReactNode) => (
    <Page
      title={meta.title}
      subtitle={scopeName ? `Картини: ${scopeName}` : undefined}
      back={<Link to="/quiz" className="t-small inline-flex items-center gap-2 text-text-secondary hover:text-accent"><Icon name="arrowLeft" size={16} /> Усі ігри</Link>}
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
        game={game} result={result} signedIn={!!user}
        onAgain={onRestart} onLogin={() => void login()}
      />,
    );
  }

  const number = run.score + (result ? (result.correct ? 0 : 1) : 1);
  return page(
    game === "pairs"
      ? <PairsQuestion key={question.images.map((i) => i.image_url).join()} question={question} result={result} busy={busy} onAnswer={answer} onNext={next} number={number} />
      : <SingleQuestion key={question.images[0].image_url} game={game} question={question} result={result} busy={busy} onAnswer={answer} onNext={next} number={number} />,
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="text-right">
      <div className="t-label">{label}</div>
      <div className="font-heading text-[40px] font-semibold leading-none">{value}</div>
    </div>
  );
}

// ---------- «Хто автор?» and «Назва картини» ----------

function SingleQuestion({ game, question, result, busy, onAnswer, onNext, number }: {
  game: QuizGame; question: QuizQuestion; result: QuizResult | null; busy: boolean; number: number;
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
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-14">
      <Artwork
        src={question.images[0].image_url}
        alt="Картина з вікторини"
        size="lg"
        crack={reveal && !reveal.correct ? "animate" : null}
      />
      <div>
        <div className="t-label">Питання {number}</div>
        <h2 className="t-h2 mt-2">{GAMES[game].prompt}</h2>
        <div className="mt-6 space-y-3" role="group" aria-label="Варіанти відповіді">
          {question.options.map((option, index) => {
            const state = !reveal ? "idle" : option.key === reveal.right ? "right" : option.key === reveal.chosen ? "wrong" : "other";
            return (
              <button
                key={option.key}
                type="button"
                disabled={busy || !!reveal}
                onClick={() => pick(option.key)}
                className={`flex w-full items-center gap-4 rounded-card border px-5 py-4 text-left transition ${OPTION_STYLE[state]} ${game === "titles" ? "font-heading text-[22px] italic leading-tight" : "t-body-lg font-semibold"}`}
                style={state === "wrong" ? { borderColor: WRONG, color: WRONG, background: `${WRONG}0f` } : undefined}
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-ui text-[13px] not-italic ${state === "right" ? "bg-white/20" : "bg-muted"}`}>
                  {state === "right" ? "✓" : state === "wrong" ? "✕" : index + 1}
                </span>
                {option.label}
              </button>
            );
          })}
        </div>
        {!reveal && <p className="t-caption mt-3 text-text-secondary">Підказка: можна відповідати клавішами 1–{question.options.length}.</p>}
        {reveal && result && <RevealCard reveal={reveal} result={result} onNext={onNext} />}
      </div>
    </div>
  );
}

const OPTION_STYLE = {
  idle: "border-line bg-surface hover:border-accent hover:bg-muted",
  right: "border-accent bg-accent text-white",
  wrong: "",
  other: "border-line bg-surface opacity-45",
} as const;

function RevealCard({ reveal, result, onNext }: { reveal: QuizReveal; result: QuizResult; onNext: () => void }) {
  const a = reveal.artwork;
  return (
    <div className="mt-6 rounded-card bg-muted p-5" role="status">
      <div className="t-label" style={reveal.correct ? undefined : { color: WRONG }}>
        {reveal.correct ? "Правильно!" : "Ой, ні"}
      </div>
      <p className="mt-2 font-heading text-[24px] font-semibold italic leading-tight">
        «{a.title}»{a.year ? `, ${a.year}` : ""}
      </p>
      <Link to={`/artists/${a.artist.slug}`} className="t-strong text-accent hover:underline">{a.artist.name} →</Link>
      {reveal.fact && <p className="t-small mt-3">{reveal.fact}</p>}
      <NextButton result={result} onNext={onNext} />
    </div>
  );
}

function NextButton({ result, onNext }: { result: QuizResult; onNext: () => void }) {
  return (
    <Button autoFocus className="mt-5 flex items-center gap-2" onClick={onNext}>
      {result.finished ? "Підсумки" : "Далі"} <Icon name="arrowRight" size={18} />
    </Button>
  );
}

// ---------- «Пари» ----------

function PairsQuestion({ question, result, busy, onAnswer, onNext, number }: {
  question: QuizQuestion; result: QuizResult | null; busy: boolean; number: number;
  onAnswer: (answer: Record<string, string>) => void; onNext: () => void;
}) {
  const [pairs, setPairs] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(question.images[0].key);
  const labels = Object.fromEntries(question.options.map((o) => [o.key, o.label]));
  const revealed = (key: string) => result?.reveals.find((r) => r.image_key === key);
  const complete = question.images.every((i) => pairs[i.key]);

  const assign = (option: string) => {
    if (result) return;
    const target = selected ?? question.images.find((i) => !pairs[i.key])?.key;
    if (!target) return;
    const nextPairs = Object.fromEntries(Object.entries(pairs).filter(([, o]) => o !== option));
    nextPairs[target] = option;
    setPairs(nextPairs);
    setSelected(question.images.find((i) => !nextPairs[i.key])?.key ?? null);
  };
  const unassign = (image: string) => {
    if (result) return;
    setPairs(Object.fromEntries(Object.entries(pairs).filter(([k]) => k !== image)));
    setSelected(image);
  };

  return (
    <div>
      <div className="t-label">Раунд {number}</div>
      <p className="t-body mt-2 text-text-secondary">
        {result ? "Ось як було насправді." : "Оберіть картину, а потім її автора. Натисніть на ім’я під картиною, щоб прибрати його."}
      </p>
      <div className="mt-6 grid grid-cols-3 gap-10">
        {question.images.map((image, index) => {
          const reveal = revealed(image.key);
          const chosen = pairs[image.key];
          return (
            <div key={image.key} className="flex flex-col">
              <button
                type="button"
                aria-label={`Картина ${index + 1}`}
                aria-pressed={selected === image.key}
                disabled={!!result}
                onClick={() => setSelected(image.key)}
                className="block text-left"
              >
                <Artwork src={image.image_url} alt={`Картина ${index + 1} з вікторини`} aspect="4/5" selected={!result && selected === image.key}
                  crack={reveal && !reveal.correct ? "animate" : null} />
              </button>
              {reveal ? (
                <div className="mt-4 rounded-card border px-4 py-3" style={{ borderColor: reveal.correct ? "var(--color-accent)" : WRONG }}>
                  <div className="t-strong" style={reveal.correct ? undefined : { color: WRONG, textDecoration: "line-through" }}>
                    {reveal.correct ? "✓ " : ""}{labels[chosen] ?? "—"}
                  </div>
                  {!reveal.correct && <div className="t-strong">✓ {labels[reveal.right]}</div>}
                  <div className="mt-1 font-heading text-[18px] italic leading-tight">
                    «{reveal.artwork.title}»{reveal.artwork.year ? `, ${reveal.artwork.year}` : ""}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => (chosen ? unassign(image.key) : setSelected(image.key))}
                  className={`mt-4 flex min-h-[52px] items-center justify-center rounded-card border-2 border-dashed px-4 py-2 text-center transition ${chosen ? "border-accent bg-surface t-strong" : selected === image.key ? "border-accent text-accent t-small" : "border-line text-text-secondary t-small"}`}
                >
                  {chosen ? labels[chosen] : selected === image.key ? "Тепер оберіть автора ↓" : "Оберіть автора"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {!result && (
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <span className="t-small text-text-secondary">Автори:</span>
          {question.options.map((option) => {
            const used = Object.values(pairs).includes(option.key);
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => assign(option.key)}
                className={`rounded-full px-5 py-2.5 text-[15px] font-semibold transition ${used ? "bg-muted text-text-secondary line-through" : "bg-accent-soft text-text hover:brightness-95"}`}
              >
                {option.label}
              </button>
            );
          })}
          <Button className="ml-auto" disabled={!complete || busy} onClick={() => onAnswer(pairs)}>Перевірити</Button>
        </div>
      )}
      {result && (
        <div className="mt-8 flex items-center gap-6 rounded-card bg-muted p-5" role="status">
          <div className="flex-1">
            <div className="t-label" style={result.correct ? undefined : { color: WRONG }}>
              {result.correct ? "Усі пари правильні!" : "Є помилка"}
            </div>
            {result.reveals[0]?.fact && <p className="t-small mt-2">{result.reveals.find((r) => !r.correct)?.fact || result.reveals[0].fact}</p>}
          </div>
          <NextButton result={result} onNext={onNext} />
        </div>
      )}
    </div>
  );
}

// ---------- the end of a run ----------

const ENDINGS = {
  mistake: { label: "Гру завершено", text: "" },
  complete: { label: "Колекцію пройдено!", text: "Ви впізнали всі картини, які є у вікторині зараз. Нові з’являться, щойно колекція поповниться." },
  guest_limit: { label: "Гостьову версію пройдено", text: "Жодної помилки! Далі — лише для відвідувачів з акаунтом." },
} as const;

function FinalCard({ game, result, signedIn, onAgain, onLogin }: {
  game: QuizGame; result: QuizResult; signedIn: boolean; onAgain: () => void; onLogin: () => void;
}) {
  const score = result.run.score;
  const ending = ENDINGS[result.finished!];
  const unit = game === "pairs"
    ? `${plural(score, "раунд", "раунди", "раундів")} без помилки`
    : `${plural(score, "правильна відповідь", "правильні відповіді", "правильних відповідей")}`;
  const guest = !signedIn && authEnabled;

  return (
    <div className="mx-auto flex max-w-[640px] flex-col items-center rounded-story border border-line bg-surface px-10 py-12 text-center">
      <div className="t-label">{ending.label}</div>
      <div className="mt-4 pb-4 font-heading text-[128px] font-semibold italic leading-[1.1] [font-variant-numeric:lining-nums]">{score}</div>
      <div className="t-body-lg text-text-secondary">{unit}</div>
      {result.new_record && (
        <div className="mt-5 rounded-full bg-accent px-4 py-1.5 text-[13px] font-bold uppercase tracking-[0.1em] text-white">Новий рекорд!</div>
      )}
      {signedIn && !result.new_record && !!result.best && (
        <div className="t-small mt-5 text-text-secondary">Ваш рекорд: <strong className="text-text">{result.best}</strong></div>
      )}
      {ending.text && <p className="t-body mt-5 max-w-[460px]">{ending.text}</p>}
      {guest && (
        <div className="mt-8 w-full rounded-card bg-muted p-5">
          <p className="t-body">Увійдіть, щоб грати без обмежень, обирати автора і зберігати рекорди.</p>
          <Button variant="secondary" className="mt-4" onClick={onLogin}>Увійти з Google</Button>
        </div>
      )}
      <div className="mt-8 flex gap-3">
        <Button onClick={onAgain}>Зіграти ще</Button>
        <Link to="/quiz" className="rounded-control bg-muted px-6 py-3 text-[15px] font-semibold leading-[1.2] transition hover:brightness-95">Усі ігри</Link>
      </div>
    </div>
  );
}
