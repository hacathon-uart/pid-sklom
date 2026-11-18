/** «Вікторина» lobby (ADR 0008): three games, best scores for signed-in visitors, guest notes. */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../api/client";
import type { QuizGame, QuizInfo } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { authEnabled } from "../auth/supabase";
import { Button } from "../components/Button";
import { ErrorMessage, Loading, Page } from "../components/Layout";
import { RopedOff } from "../components/Museum";
import { bestKey, GAME_ORDER, GAMES } from "../quiz/games";

export function QuizPage() {
  const { user, ready, login } = useAuth();
  const [info, setInfo] = useState<QuizInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!ready) return; // wait for the session, so best scores come back with the first request
    let active = true;
    setError(null);
    api.quiz().then((value) => active && setInfo(value)).catch((e: Error) => active && setError(e.message));
    return () => { active = false; };
  }, [ready, user?.id, attempt]);

  return (
    <Page
      title="Вікторина"
      subtitle="Подивіться на картину й пригадайте, хто її написав і як вона називається. Одна помилка завершує гру, а після кожної відповіді — коротка історія картини."
    >
      {error ? (
        <ErrorMessage error={error} onRetry={() => setAttempt((n) => n + 1)} />
      ) : !info ? (
        <Loading />
      ) : info.games.length === 0 ? (
        <RopedOff>Картин поки замало для вікторини. Загляньте, коли колекція поповниться.</RopedOff>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-6">
            {GAME_ORDER.filter((game) => info.games.includes(game)).map((game) => (
              <GameCard key={game} game={game} info={info} />
            ))}
          </div>
          {info.limited && authEnabled && (
            <div className="mt-8 flex items-center gap-6 rounded-card bg-muted px-6 py-5">
              <p className="t-body flex-1">
                Гості грають коротку версію кожної гри. Увійдіть, щоб грати без обмежень, обирати автора
                в «Назві картини» і зберігати рекорди в профілі.
              </p>
              <Button variant="secondary" className="shrink-0" onClick={() => void login()}>Увійти з Google</Button>
            </div>
          )}
        </>
      )}
    </Page>
  );
}

function GameCard({ game, info }: { game: QuizGame; info: QuizInfo }) {
  const navigate = useNavigate();
  const meta = GAMES[game];
  const scopes = game === "titles" ? info.title_scopes.filter((s) => !info.limited || s.key === "all") : [];
  const [scope, setScope] = useState(scopes[0]?.key ?? "all");
  const best = info.best?.[bestKey(game, scope)];
  const play = () => navigate(`/quiz/${game}${game === "titles" ? `?scope=${encodeURIComponent(scope)}` : ""}`);

  return (
    <section className="flex flex-col rounded-card border border-line bg-surface p-6">
      <div className="flex items-start justify-between">
        <span className="hall-no" aria-hidden>{meta.no}</span>
        <span className="t-label">{meta.level}</span>
      </div>
      <h2 className="t-h2 mt-4">{meta.title}</h2>
      <p className="t-small mt-2 flex-1 text-text-secondary">{meta.text}</p>

      {game === "titles" && scopes.length > 1 && (
        <label className="mt-5 block">
          <span className="t-caption text-text-secondary">Картини</span>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="mt-1 h-11 w-full rounded-control border border-line bg-surface px-3 text-[15px]"
          >
            {scopes.map((s) => (
              <option key={s.key} value={s.key}>{s.key === "all" ? "Усі картини" : s.name} · {s.artworks}</option>
            ))}
          </select>
        </label>
      )}

      <div className="mt-5 flex items-center justify-between gap-4 border-t border-line pt-4">
        <span className="t-small text-text-secondary">
          {info.limited
            ? meta.guestNote(info.guest_limits[game])
            : best !== undefined ? <>Ваш рекорд: <strong className="text-text">{best}</strong></> : "Рекорду ще немає"}
        </span>
        <Button onClick={play} className="shrink-0">Грати</Button>
      </div>
    </section>
  );
}
