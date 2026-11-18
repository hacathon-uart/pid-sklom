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
import { inventoryNo } from "../components/Museum";
import { plural } from "../plural";
import { bestKey, GAMES } from "../quiz/games";
import { BrassPlaque, rank, Turnstile } from "../quiz/Museum";

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

  // S1 · the visitor turnstile counts right answers; the record is a brass plaque beside it.
  const header = (
    <div className="flex items-center gap-5">
      <div className="text-center">
        <div className="t-label mb-2">Рахунок</div>
        <Turnstile value={run?.score ?? 0} label="Рахунок" />
        {run?.limit && <div className="t-caption mt-2 text-text-secondary">гостьовий: з {run.limit}</div>}
      </div>
      {user && (
        <BrassPlaque className="self-end">
          <span className="engraved text-[19px]">Рекорд {best ?? "—"}</span>
        </BrassPlaque>
      )}
    </div>
  );
  const page = (children: ReactNode) => (
    <Page
      title={meta.title}
      subtitle={scopeName ? `Картини: ${scopeName}` : undefined}
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
                className={`catalogue-card ${state === "other" ? "faded" : ""} ${state === "wrong" ? "struck" : ""}`}
              >
                <span className="card-no">{index + 1}</span>
                <span className="card-text min-w-0 flex-1 pr-36">{option.label}</span>
                {state === "right" && <span className="stamp stamp-right">ПРАВИЛЬНО</span>}
                {state === "wrong" && <span className="stamp stamp-wrong">НЕПРАВИЛЬНО</span>}
                <span className="card-hole" aria-hidden />
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

/** After an answer: the painting's museum label, with one reviewed fact. */
function RevealCard({ reveal, result, onNext }: { reveal: QuizReveal; result: QuizResult; onNext: () => void }) {
  const a = reveal.artwork;
  return (
    <div className="mt-8" role="status">
      <div className="t-label" style={reveal.correct ? undefined : { color: WRONG }}>
        {reveal.correct ? "Правильно! Ось етикетка картини" : "Ой, ні. Ось етикетка картини"}
      </div>
      <div className="wall-label mt-3 !p-5">
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
        {result
          ? "Ось як було насправді."
          : "Повісьте етикетки під картини: оберіть картину, а потім етикетку з лотка. Натисніть на повішену етикетку, щоб зняти її."}
      </p>
      {/* P1 · blank wall labels from the curator's tray, hung on hooks under the paintings */}
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
              <span className="label-hook mt-3" aria-hidden />
              {reveal ? (
                <div className="wall-label" style={reveal.correct ? undefined : { boxShadow: `0 0 0 2px ${WRONG}` }}>
                  {!reveal.correct && <div className="wl-who" style={{ color: WRONG, textDecoration: "line-through" }}>{labels[chosen] ?? "—"}</div>}
                  <div className="wl-who">{reveal.correct ? "✓ " : ""}{labels[reveal.right]}</div>
                  <div className="wl-what">«{reveal.artwork.title}»{reveal.artwork.year ? `, ${reveal.artwork.year}` : ""}</div>
                  <div className="wl-inv">Інв. № {inventoryNo(reveal.artwork.id)}</div>
                </div>
              ) : chosen ? (
                <button type="button" onClick={() => unassign(image.key)} className="wall-label text-left transition hover:-translate-y-0.5" title="Зняти етикетку">
                  <div className="wl-who">{labels[chosen]}</div>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setSelected(image.key)}
                  className={`flex min-h-[64px] items-center justify-center border-2 border-dashed px-4 py-2 text-center transition t-small ${selected === image.key ? "border-accent text-accent" : "border-line text-text-secondary"}`}
                >
                  {selected === image.key ? "Тепер оберіть етикетку з лотка ↓" : "Повісьте етикетку"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {!result && (
        <div className="label-tray mt-10 flex flex-wrap items-center gap-4 rounded-card px-6 py-5">
          <span className="t-label !text-[#C9B08F]">Лоток куратора</span>
          {question.options.map((option) => {
            const used = Object.values(pairs).includes(option.key);
            return (
              <button
                key={option.key}
                type="button"
                disabled={used}
                onClick={() => assign(option.key)}
                className={`wall-label text-left transition ${used ? "opacity-30" : "hover:-translate-y-0.5"}`}
              >
                <span className="wl-who">{option.label}</span>
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
              {result.correct ? "Усі етикетки на своїх місцях!" : "Одна з етикеток висить не там"}
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

/** R1 · a museum certificate with a rank and a wax seal; guests get it stamped «ТИМЧАСОВЕ». */
function FinalCard({ game, result, signedIn, onAgain, onLogin }: {
  game: QuizGame; result: QuizResult; signedIn: boolean; onAgain: () => void; onLogin: () => void;
}) {
  const score = result.run.score;
  const ending = ENDINGS[result.finished!];
  const unit = game === "pairs"
    ? `${plural(score, "раунд", "раунди", "раундів")} без помилки`
    : `${plural(score, "картина впізнана", "картини впізнано", "картин впізнано")}`;
  const guest = !signedIn && authEnabled;
  const date = new Date().toLocaleDateString("uk-UA", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="mx-auto flex max-w-[620px] flex-col items-center">
      <div className="certificate w-full px-12 pb-16 pt-12 text-center">
        {guest && <span className="temp-stamp" aria-label="Тимчасове посвідчення">ТИМЧАСОВЕ</span>}
        <div className="t-label">{ending.label}</div>
        <h2 className="mt-3 font-heading text-[52px] font-semibold italic leading-none">Посвідчення</h2>
        <p className="t-small mt-2 text-text-secondary">видано за знання колекції · {GAMES[game].title}</p>
        {/* Old-style figures (T2) hang below the line, so the score gets room underneath. */}
        <div className="mt-5 pb-3 font-heading text-[120px] font-semibold leading-[1.15]">{score}</div>
        <div className="t-body-lg text-text-secondary">{unit}</div>
        <p className="mt-5 font-heading text-[26px] leading-tight">
          Звання: <strong className="italic">{rank(game, score, result.finished!)}</strong>
        </p>
        {result.new_record && <p className="t-label mt-4">Новий рекорд!</p>}
        {signedIn && !result.new_record && !!result.best && (
          <p className="t-small mt-4 text-text-secondary">Ваш рекорд: <strong className="text-text">{result.best}</strong></p>
        )}
        {ending.text && <p className="t-small mx-auto mt-4 max-w-[420px] text-text-secondary">{ending.text}</p>}
        <p className="t-caption mt-6 text-text-secondary">{date}</p>
        <div className="wax-seal" aria-hidden>ПІД<br />СКЛОМ</div>
      </div>
      {guest && (
        <div className="mt-12 w-full rounded-card bg-muted p-5 text-center">
          <p className="t-body">Посвідчення тимчасове. Увійдіть, щоб грати без обмежень, обирати автора і потрапити на почесну дошку.</p>
          <Button variant="secondary" className="mt-4" onClick={onLogin}>Увійти з Google</Button>
        </div>
      )}
      <div className={`flex gap-3 ${guest ? "mt-6" : "mt-12"}`}>
        <Button onClick={onAgain}>Зіграти ще</Button>
        <Link to="/quiz" className="rounded-control bg-muted px-6 py-3 text-[15px] font-semibold leading-[1.2] transition hover:brightness-95">Усі зали</Link>
      </div>
    </div>
  );
}
