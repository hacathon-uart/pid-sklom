/** Screen 4 · Профіль — мої меми (US-08). Requires login. */
import { useState } from "react";
import { api } from "../api/client";
import { useApi } from "../api/useApi";
import { useAuth } from "../auth/AuthContext";
import { Button } from "../components/Button";
import { MemeCard } from "../components/cards";
import { ErrorMessage, Loading, Page } from "../components/Layout";
import { Portrait } from "../components/Portrait";
import { Tag } from "../components/Tag";

export function MyMemesPage() {
  const { user, login, logout } = useAuth();
  if (!user) {
    return (
      <Page title="Мої меми" subtitle="Увійдіть, щоб зберігати меми і повертатися до них.">
        <Button onClick={login}>Увійти</Button>
      </Page>
    );
  }
  return <MyMemes name={user.name} avatar={user.avatarUrl} onLogout={logout} />;
}

function MyMemes({ name, avatar, onLogout }: { name: string; avatar?: string | null; onLogout: () => void }) {
  const [favorite, setFavorite] = useState(false);
  const [oldestFirst, setOldestFirst] = useState(false);
  const { data, error, loading, reload } = useApi(() => api.memes(favorite || undefined), [favorite]);
  const memes = oldestFirst && data ? [...data].reverse() : data;

  return (
    <Page
      title="Мої меми"
      subtitle={data ? `${data.length} збережених мемів` : " "}
      actions={
        <>
          <Portrait src={avatar} name={name} size={44} />
          <span className="t-body">{name}</span>
          <Button variant="soft" onClick={onLogout}>Вийти</Button>
        </>
      }
    >
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
        <p className="t-body text-text-secondary">Тут поки порожньо. Створіть свій перший мем!</p>
      ) : (
        <div className="grid grid-cols-4 gap-8">
          {memes!.map((m) => (
            <MemeCard key={m.id} meme={m} />
          ))}
        </div>
      )}
    </Page>
  );
}
