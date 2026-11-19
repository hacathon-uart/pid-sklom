/** Screen 4 · Профіль — мої меми (US-08). Requires login. */
import { useState } from "react";
import { api } from "../api/client";
import { useApi } from "../api/useApi";
import { useAuth } from "../auth/AuthContext";
import { authEnabled } from "../auth/supabase";
import { Button } from "../components/Button";
import { MemeCard } from "../components/cards";
import { ErrorMessage, Loading, Page } from "../components/Layout";
import { RopedOff, Ticket } from "../components/Museum";
import { Tag } from "../components/Tag";
import { RecordTickets } from "../quiz/Museum";

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
        <Button className="min-h-11 w-full whitespace-normal sm:w-auto" onClick={login}>Продовжити через Google</Button>
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
        <div className="flex min-w-0 flex-wrap items-center gap-3 [overflow-wrap:anywhere] [&_.ticket]:max-w-full [&_.ticket]:grid-cols-[minmax(0,1fr)_auto]">
          <Ticket title={name} subtitle="Відвідувач «Під склом»" number={data ? data.length : "…"} />
          <Button variant="soft" onClick={onLogout}>Вийти</Button>
        </div>
      }
    >
      <QuizRecords />
      <div className="mb-8 flex flex-wrap gap-2">
        <Tag className="min-h-11" active={!favorite} onClick={() => setFavorite(false)}>Усі</Tag>
        <Tag className="min-h-11" active={favorite} onClick={() => setFavorite(true)}>Улюблені</Tag>
        <Tag className="min-h-11" onClick={() => setOldestFirst(!oldestFirst)}>{oldestFirst ? "Від старих до нових" : "Від нових до старих"}</Tag>
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
        <div className="grid grid-cols-1 gap-x-4 gap-y-8 min-[375px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 xl:gap-x-8 xl:gap-y-10">
          {memes!.map((m) => (
            <MemeCard key={m.id} meme={m} />
          ))}
        </div>
      )}
    </Page>
  );
}

/** Best quiz scores and museum ranks (ADR 0008): one entrance ticket per game (C4). */
function QuizRecords() {
  const { data } = useApi(() => api.quiz(), []);
  if (!data?.best || Object.keys(data.best).length === 0) return null;
  return <RecordTickets info={data} />;
}
