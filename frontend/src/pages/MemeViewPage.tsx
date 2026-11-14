/** Screen 4b · Профіль — перегляд мему (US-08, US-16). Also used as the public share page /m/:id. */
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api/client";
import type { Meme } from "../api/types";
import { useApi } from "../api/useApi";
import { Artwork } from "../components/Artwork";
import { Button, IconButton } from "../components/Button";
import { years } from "../components/cards";
import { Icon } from "../components/Icon";
import { ErrorMessage, Loading, Page } from "../components/Layout";
import { Portrait } from "../components/Portrait";
import { downloadDataUrl } from "../editor/exportPng";

export function MemeViewPage({ isPublic = false }: { isPublic?: boolean }) {
  const { memeId = "" } = useParams();
  const navigate = useNavigate();
  const meme = useApi(() => api.meme(memeId), [memeId]);
  // Bookmark: un-saving deletes the meme on the server but keeps showing it here until the user leaves.
  // undefined = still the loaded meme; null = un-saved; string = id of the (re-)saved meme.
  const [liveId, setLiveId] = useState<string | null | undefined>(undefined);
  const [pngCache, setPngCache] = useState<string | null>(null); // image kept in the browser while un-saved
  const [actionError, setActionError] = useState<string | null>(null);
  const artworkId = meme.data?.artwork.id;
  const artistSlug = meme.data?.artwork.artist.slug;
  const detail = useApi(() => (artworkId ? api.artwork(artworkId) : Promise.resolve(null)), [artworkId]);
  const artist = useApi(() => (artistSlug ? api.artist(artistSlug) : Promise.resolve(null)), [artistSlug]);

  const back = !isPublic && (
    <Link to="/me" className="t-strong flex items-center gap-2 text-accent">
      <Icon name="arrowLeft" size={18} /> Мої меми
    </Link>
  );

  if (meme.loading) return <Page title="Мій мем" back={back}><Loading /></Page>;
  if (meme.error || !meme.data) return <Page title="Мій мем" back={back}><ErrorMessage error={meme.error ?? "Помилка"} /></Page>;

  const m = meme.data;
  const a = m.artwork;
  const currentId = liveId === undefined ? m.id : liveId;
  const saved = currentId !== null;
  const toggleFavorite = async () => {
    if (currentId) meme.setData(await api.updateMeme(currentId, { is_favorite: !m.is_favorite }));
  };
  const toggleSaved = async () => {
    setActionError(null);
    try {
      if (currentId) {
        // The server deletes the PNG with the meme, so keep a copy first (used to display it and to re-save).
        const png = m.image_url ? await urlToDataUrl(m.image_url) : null;
        await api.deleteMeme(currentId);
        setPngCache(png);
        setLiveId(null);
      } else {
        const created: Meme = await api.createMeme(a.id, m.style, pngCache ?? undefined);
        setPngCache(null);
        meme.setData(created);
        setLiveId(created.id);
        window.history.replaceState(null, "", `/me/memes/${created.id}`); // keep the URL valid without reloading
      }
    } catch (e) {
      setActionError((e as Error).message);
    }
  };
  const share = async () => {
    // TODO(B, US-16): public link with preview image (OG tags need server-side rendering or a backend route)
    await navigator.clipboard.writeText(`${window.location.origin}/m/${m.id}`);
    alert("Посилання скопійовано");
  };
  const savedOn = new Date(m.created_at).toLocaleDateString("uk-UA", { day: "numeric", month: "long", year: "numeric" });

  return (
    <Page title={isPublic ? "Мем" : "Мій мем"} subtitle={`Збережено ${savedOn}`} back={back}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-8">
        <div>
          <div className="flex items-center gap-5">
            <Portrait src={a.artist.portrait_url} name={a.artist.name} />
            <div>
              <h2 className="t-h2">{a.artist.name}</h2>
              <div className="t-small text-text-secondary">
                {years(a.artist)} · «{a.title}»{a.year ? `, ${a.year}` : ""}
              </div>
            </div>
          </div>
          {detail.data && (
            <>
              <h3 className="t-h3 mt-8">Про картину</h3>
              <p className="t-body mt-2 text-text-secondary">{detail.data.story.about_artwork}</p>
              {detail.data.story.artist_fact && (
                <>
                  <h3 className="t-h3 mt-6">Цікаві факти про митця</h3>
                  <p className="t-body mt-2 text-text-secondary">{detail.data.story.artist_fact.text}</p>
                </>
              )}
            </>
          )}
          {artist.data && (
            <section className="mt-12">
              <div className="t-label mb-4">Ще від цього автора</div>
              <div className="grid grid-cols-4 gap-4">
                {artist.data.artworks.filter((w) => w.id !== a.id).slice(0, 4).map((w) => (
                  <Link key={w.id} to={`/create/painting?artwork=${w.id}`}>
                    <Artwork src={w.thumb_url} alt={w.title} aspect="4/5" />
                  </Link>
                ))}
              </div>
              <Link to={`/artists/${a.artist.slug}`} className="t-strong mt-4 inline-block text-accent">Сторінка автора →</Link>
            </section>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <IconButton icon="download" label="Завантажити" onClick={() => m.image_url && downloadDataUrl(m.image_url)} />
          <IconButton icon="share" label="Поділитися" onClick={share} />
          {!isPublic && (
            <>
              <IconButton icon="bookmark" label={saved ? "Видалити з «Моїх мемів»" : "Зберегти в «Мої меми»"} active={saved} onClick={toggleSaved} />
              <IconButton icon="heart" label="Додати до улюблених" active={saved && m.is_favorite} disabled={!saved} onClick={toggleFavorite} />
            </>
          )}
        </div>

        <div>
          <Artwork src={(!saved && pngCache) || m.image_url || a.image_url} alt={m.caption} />
          {actionError && <ErrorMessage error={actionError} />}
          {!isPublic && (
            <div className="mt-4 flex gap-3">
              <Button variant="secondary" disabled={!saved} onClick={() => currentId && navigate(`/me/memes/${currentId}/edit`)}>Редагувати</Button>
            </div>
          )}
          {isPublic && <ArtworkCardLink id={a.id} />}
        </div>
      </div>
    </Page>
  );
}

function ArtworkCardLink({ id }: { id: number }) {
  return (
    <Link to={`/create/painting?artwork=${id}`} className="mt-4 inline-block">
      <Button>Зробити свій мем з цієї картини</Button>
    </Link>
  );
}

async function urlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Не вдалося завантажити зображення мему");
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
