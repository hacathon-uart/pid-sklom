/** Screen 2b · Картина → підпис — вибір картини (US-02). URL: ?artwork=<id> preselects; ?mode=own|ai picks the main button. */
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { api } from "../api/client";
import { GENRE_LABELS, type ArtworkSummary, type Genre } from "../api/types";
import { useApi } from "../api/useApi";
import { Button } from "../components/Button";
import { ArtworkCard } from "../components/cards";
import { SearchInput } from "../components/Input";
import { ErrorMessage, Loading, Page } from "../components/Layout";
import { ModeSwitch } from "../components/ModeSwitch";
import { VelvetRope } from "../components/Museum";
import { Tag } from "../components/Tag";

export function ChoosePaintingPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [q, setQ] = useState("");
  const [genre, setGenre] = useState<Genre | null>(null);
  const [selected, setSelected] = useState<ArtworkSummary | null>(null);
  const ownFirst = params.get("mode") === "own";
  // TODO(B): debounce search; pagination when the catalogue grows past ~50
  const { data, error, loading, reload } = useApi(() => api.artworks({ q, genre, limit: 50 }), [q, genre]);

  useEffect(() => {
    const id = Number(params.get("artwork"));
    if (id) api.artwork(id).then(setSelected).catch(() => {});
  }, [params]);

  const random = async () => setSelected(await api.randomArtwork());

  return (
    <Page title="Створити мем" subtitle="Оберіть картину, а підпис запропонує ШІ або напишете ви самі" actions={<ModeSwitch />}>
      <div className="mb-8 flex items-center gap-3">
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Автор, назва або настрій" className="max-w-[370px]" />
        <Tag active={genre === null} onClick={() => setGenre(null)}>Усі</Tag>
        {(Object.keys(GENRE_LABELS) as Genre[]).map((g) => (
          <Tag key={g} active={genre === g} onClick={() => setGenre(g)}>{GENRE_LABELS[g]}</Tag>
        ))}
        <Button variant="secondary" className="ml-auto" onClick={random}>Випадкова картина</Button>
      </div>

      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorMessage error={error} onRetry={reload} />
      ) : data!.items.length === 0 ? (
        <p className="t-body text-text-secondary">Нічого не знайшли. Спробуйте інше слово.</p>
      ) : (
        <div className="grid grid-cols-5 gap-6">
          {data!.items.map((a) => (
            <ArtworkCard key={a.id} artwork={a} selected={selected?.id === a.id} onClick={() => setSelected(a)} />
          ))}
        </div>
      )}

      {/* pb-40 keeps the rope clear of the «Обрано» bar that floats at the bottom */}
      <div className="mt-16 flex justify-center pb-40">
        <VelvetRope />
      </div>

      {selected && (
        <div className="fixed inset-x-0 bottom-6 pl-[var(--sidebar-width)]">
          <div className="mx-auto flex max-w-[1150px] items-center gap-5 rounded-story border border-accent bg-surface p-4 shadow-lg">
            <img src={selected.thumb_url} alt="" className="h-24 w-20 shrink-0 rounded-control object-cover" />
            <div>
              <div className="t-label">Обрано</div>
              <div className="t-strong">{selected.title}{selected.year ? `, ${selected.year}` : ""}</div>
              <div className="t-small text-text-secondary">{selected.artist.name}</div>
            </div>
            <div className="ml-auto flex gap-3">
              <Button variant="soft" onClick={() => setSelected(null)}>Скинути вибір</Button>
              {/* ?mode=own (home page, path III) makes «own caption» the main button */}
              <Button variant={ownFirst ? "primary" : "secondary"} onClick={() => navigate(`/create/painting/${selected.id}/own`)}>Написати свій підпис</Button>
              <Button variant={ownFirst ? "secondary" : "primary"} onClick={() => navigate(`/create/painting/${selected.id}/ai`)}>Згенерувати підпис</Button>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
