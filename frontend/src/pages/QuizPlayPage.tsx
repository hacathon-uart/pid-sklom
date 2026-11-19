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
import { CertificateCrest, CertificateFrame, InkStamp, OrnamentRule, Signature } from "../quiz/Certificate";
import { CloakroomTag, percent, rankName, share } from "../quiz/Museum";

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
        game={game} scope={scope} scopeName={scopeName} result={result} signedIn={!!user} artworks={artworks}
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
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-14">
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
    <Button autoFocus className="mt-5 flex min-h-11 w-full items-center justify-center gap-2 md:w-auto" onClick={onNext}>
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
    if (busy || result) return;
    const target = selected ?? question.images.find((i) => !pairs[i.key])?.key;
    if (!target) return;
    const nextPairs = Object.fromEntries(Object.entries(pairs).filter(([, o]) => o !== option));
    nextPairs[target] = option;
    setPairs(nextPairs);
    setSelected(question.images.find((i) => !nextPairs[i.key])?.key ?? null);
  };
  const unassign = (image: string) => {
    if (busy || result) return;
    setPairs(Object.fromEntries(Object.entries(pairs).filter(([k]) => k !== image)));
    setSelected(image);
  };

  const optionButtons = () => question.options.map((option) => {
    const used = Object.values(pairs).includes(option.key);
    return (
      <button
        key={option.key}
        type="button"
        disabled={used || busy || !selected}
        onClick={() => assign(option.key)}
        className={`wall-label min-h-11 min-w-0 break-words text-left transition focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent ${used ? "opacity-30" : "hover:-translate-y-0.5"}`}
      >
        <span className="wl-who">{option.label}</span>
      </button>
    );
  });

  return (
    <div>
      <div className="t-label">Раунд {number}</div>
      <p className="t-body mt-2 text-text-secondary">
        {result
          ? "Ось як було насправді."
          : "Повісьте етикетки під картини: оберіть картину, а потім етикетку з лотка. Натисніть на повішену етикетку, щоб зняти її."}
      </p>
      {/* P1 · blank wall labels from the curator's tray, hung on hooks under the paintings */}
      <div className="mt-6 grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-6 lg:gap-10">
        {question.images.map((image, index) => {
          const reveal = revealed(image.key);
          const chosen = pairs[image.key];
          return (
            <div key={image.key} className="flex min-w-0 flex-col break-words">
              <button
                type="button"
                aria-label={`Картина ${index + 1}`}
                aria-pressed={selected === image.key}
                disabled={busy || !!result}
                onClick={() => setSelected(image.key)}
                className="block text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
              >
                <Artwork src={image.image_url} alt={`Картина ${index + 1} з вікторини`} aspect="4/5" selected={!result && selected === image.key}
                  crack={reveal && !reveal.correct ? "animate" : null} />
              </button>
              <span className="t-small mt-3 text-center">Картина {index + 1}{!result && selected === image.key ? " · Обрано" : ""}</span>
              <span className="label-hook mt-3" aria-hidden />
              {reveal ? (
                <div className="wall-label" style={reveal.correct ? undefined : { boxShadow: `0 0 0 2px ${WRONG}` }}>
                  {!reveal.correct && <div className="wl-who" style={{ color: WRONG, textDecoration: "line-through" }}>{labels[chosen] ?? "—"}</div>}
                  <div className="wl-who">{reveal.correct ? "✓ " : ""}{labels[reveal.right]}</div>
                  <div className="wl-what">«{reveal.artwork.title}»{reveal.artwork.year ? `, ${reveal.artwork.year}` : ""}</div>
                  <div className="wl-inv">Інв. № {inventoryNo(reveal.artwork.id)}</div>
                </div>
              ) : chosen ? (
                <button type="button" disabled={busy} onClick={() => unassign(image.key)} className="wall-label min-h-11 text-left transition disabled:opacity-50 hover:-translate-y-0.5" aria-label={`Зняти етикетку: ${labels[chosen]}`} title="Зняти етикетку">
                  <div className="wl-who">{labels[chosen]}</div>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={selected === image.key}
                  onClick={() => setSelected(image.key)}
                  className={`flex min-h-[64px] items-center justify-center border-2 border-dashed px-4 py-2 text-center transition t-small ${selected === image.key ? "border-accent text-accent" : "border-line text-text-secondary"}`}
                >
                  {selected === image.key ? "Тепер оберіть етикетку нижче ↓" : "Повісьте етикетку"}
                </button>
              )}
              {!result && selected === image.key && (
                <div className="label-tray mt-4 grid gap-3 rounded-card p-4 md:hidden" role="group" aria-label={`Етикетки для картини ${index + 1}`}>
                  <span className="t-label !text-[#C9B08F]">Оберіть етикетку</span>
                  {optionButtons()}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!result && (
        <div className="label-tray mt-6 flex flex-wrap items-center gap-4 rounded-card p-4 md:mt-10 md:px-6 md:py-5">
          <span className="t-label !text-[#C9B08F]">Лоток куратора</span>
          <div className="hidden flex-wrap gap-4 md:flex">{optionButtons()}</div>
          <Button className="min-h-11 w-full md:ml-auto md:w-auto" disabled={!complete || busy} onClick={() => onAnswer(pairs)}>{busy ? "Перевіряємо…" : "Перевірити"}</Button>
        </div>
      )}
      {result && (
        <div className="mt-8 flex flex-col items-stretch gap-4 rounded-card bg-muted p-5 md:flex-row md:items-center md:gap-6" role="status">
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
function FinalCard({ game, scope, scopeName, result, signedIn, artworks, onAgain, onLogin }: {
  game: QuizGame; scope: string; scopeName: string | null; result: QuizResult; signedIn: boolean; artworks: number | null; onAgain: () => void; onLogin: () => void;
}) {
  const score = result.run.score;
  // Finishing one artist's works is not finishing the collection, so «complete» only counts on the whole one.
  const part = share(game, score, artworks ?? Math.max(score, 1), scope === "all" ? result.finished : null);
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
          <div className="t-label">Звання</div>
          {/* The rules sit on the rank's own row, so they line up with the middle of the text, not of the label above it. */}
          <div className="mt-1 flex min-w-0 items-center justify-center gap-2 md:gap-4">
            <span className="hidden h-px w-14 shrink-0 bg-accent-soft md:block lg:w-10" />
            <div className="min-w-0 break-words font-heading text-3xl md:text-[40px] font-semibold italic leading-tight lg:text-[46px]">{rankName(part)}</div>
            <span className="hidden h-px w-14 shrink-0 bg-accent-soft md:block lg:w-10" />
          </div>
          <p className="t-small mt-1 text-text-secondary">впізнано {percent(part)} колекції</p>
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
          <p className="t-body">Посвідчення тимчасове. Увійдіть, щоб грати без обмежень, обирати автора і зберегти звання в профілі.</p>
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
