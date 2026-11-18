/** Screen 4 · Профіль — мої меми (US-08). Requires login. */
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api/client";
import { useApi } from "../api/useApi";
import { useAuth } from "../auth/AuthContext";
import { authEnabled } from "../auth/supabase";
import { Button } from "../components/Button";
import { MemeCard } from "../components/cards";
import { ErrorMessage, Loading, Page } from "../components/Layout";
import { RopedOff, Ticket } from "../components/Museum";
import { Tag } from "../components/Tag";
import { GAME_ORDER, GAMES } from "../quiz/games";

export function MyMemesPage() {
  const { user, login, logout } = useAuth();
  if (!authEnabled) {
    return (
      <Page title="Мої меми" subtitle="Збереження в акаунт поки недоступне. Створюйте меми та завантажуйте PNG.">
        <Button onClick={() => window.location.assign("/create")}>Створити мем</Button>
      </Page>
    );
  }
  if (!user) {
    return (
      <Page title="Мої меми" subtitle="Увійдіть, щоб зберігати меми і повертатися до них.">
        <Button onClick={login}>Продовжити через Google</Button>
        <p className="t-small mt-3 text-text-secondary">Новий акаунт створиться автоматично</p>
      </Page>
    );
  }
  return <MyMemes name={user.name} onLogout={logout} />;
}

function MyMemes({ name, onLogout }: { name: string; onLogout: () => void }) {
  const [favorite, setFavorite] = useState(false);
  const [oldestFirst, setOldestFirst] = useState(false);
  const { data, error, loading, reload } = useApi(() => api.memes(favorite || undefined), [favorite]);
  const memes = oldestFirst && data ? [...data].reverse() : data;

  return (
    <Page
      title="Мої меми"
      subtitle={data ? `${data.length} у вашій колекції · улюблені позначені тріснутим склом` : " "}
      actions={
        <>
          <Ticket title={name} subtitle="Відвідувач «Під склом»" number={data ? data.length : "…"} />
          <Button variant="soft" onClick={onLogout}>Вийти</Button>
        </>
      }
    >
      <QuizRecords />
      <div className="mb-8 flex gap-2">
        <Tag active={!favorite} onClick={() => setFavorite(false)}>Усі</Tag>
        <Tag active={favorite} onClick={() => setFavorite(true)}>Улюблені</Tag>
        <Tag onClick={() => setOldestFirst(!oldestFirst)}>{oldestFirst ? "Від старих до нових" : "Від нових до старих"}</Tag>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorMessage error={error} onRetry={reload} />
      ) : memes!.length === 0 ? (
        <RopedOff>
          {favorite
            ? "Улюблених поки немає. Поставте ♥ найкращому мему, і скло на ньому трісне від гордості."
            : "Тут поки порожньо. Не торкатися — бо нічого. Створіть свій перший мем!"}
        </RopedOff>
      ) : (
        <div className="grid grid-cols-4 gap-x-8 gap-y-10">
          {memes!.map((m) => (
            <MemeCard key={m.id} meme={m} />
          ))}
        </div>
      )}
    </Page>
  );
}

/** Best quiz scores (ADR 0008). «Назва картини» shows the best of all its scopes. */
function QuizRecords() {
  const { data } = useApi(() => api.quiz(), []);
  const best = data?.best;
  if (!best || Object.keys(best).length === 0) return null;
  const score = (game: string) => game === "titles"
    ? Math.max(...Object.entries(best).filter(([k]) => k.startsWith("titles:")).map(([, v]) => v), -1)
    : best[game] ?? -1;
  return (
    <div className="mb-8 flex items-center gap-10 rounded-card border border-line bg-surface px-6 py-4">
      <span className="t-label">Рекорди вікторини</span>
      {GAME_ORDER.map((game) => (
        <div key={game} className="flex items-baseline gap-2">
          <span className="t-small text-text-secondary">{GAMES[game].title}</span>
          <strong className="font-heading text-[28px] leading-none">{score(game) >= 0 ? score(game) : "—"}</strong>
        </div>
      ))}
      <Link to="/quiz" className="t-strong ml-auto text-accent hover:underline">До вікторини →</Link>
    </div>
  );
}
