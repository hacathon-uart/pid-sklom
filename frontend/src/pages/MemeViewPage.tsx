/** Screen 4b · Профіль — перегляд мему (US-08, US-16). Also used as the public share page /m/:id. */
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api/client";
import type { Frame } from "../api/types";
import { useApi } from "../api/useApi";
import { Artwork } from "../components/Artwork";
import { Button, IconButton } from "../components/Button";
import { years } from "../components/cards";
import { Icon } from "../components/Icon";
import { ErrorMessage, Loading, Page } from "../components/Layout";
import { Portrait } from "../components/Portrait";
import { framePng, urlToDataUrl } from "../editor/exportPng";
import { FramePicker } from "../editor/FramePicker";
import { forgetSaved, useTabState } from "../auth/workflow";
import { useMemeExport } from "../editor/useMemeExport";

export function MemeViewPage({ isPublic = false }: { isPublic?: boolean }) {
  const { memeId = "" } = useParams();
  const navigate = useNavigate();
  const meme = useApi(() => api.meme(memeId), [memeId]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [justLiked, setJustLiked] = useState(false); // play the crack only when ♥ is pressed now
  const [withFrame, setWithFrame] = useTabState(`export-frame:meme:${memeId}`, true);
  const exporting = useMemeExport(`meme:${memeId}`, meme.data?.artwork.id ?? 0, async () => {
    const src = meme.data?.image_url;
    if (!src) throw new Error("Для цього мему ще немає PNG");
    return withFrame ? framePng(src, meme.data?.style.frame ?? "gold") : urlToDataUrl(src);
  }, () => Boolean(meme.data?.image_url));
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
  const toggleFavorite = async () => {
    try {
      setActionError(null);
      setJustLiked(!m.is_favorite);
      meme.setData(await api.updateMeme(m.id, { is_favorite: !m.is_favorite }));
    } catch (failure) { setActionError((failure as Error).message); }
  };
  const canEdit = !isPublic && m.can_edit;
  const frame: Frame = m.style.frame ?? "gold";
  const changeFrame = async (f: Frame) => {
    const style = { ...m.style, frame: f };
    try {
      setActionError(null);
      meme.setData(await api.updateMeme(m.id, { style }));
    } catch (failure) { setActionError((failure as Error).message); }
  };
  const toggleSaved = async () => {
    if (!window.confirm("Видалити мем і PNG? Посилання перестане працювати. Завантажені копії залишаться в одержувачів.")) return;
    setActionError(null);
    try {
      await api.deleteMeme(m.id);
      forgetSaved(m.id);
      navigate("/me", { replace: true });
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
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-14">
        <div>
          {/* The caption is part of the PNG, so the whole picture is the click target for editing. */}
          <div
            role={canEdit ? "button" : undefined}
            tabIndex={canEdit ? 0 : undefined}
            aria-label={canEdit ? "Редагувати підпис" : undefined}
            title={canEdit ? "Натисніть, щоб змінити підпис" : undefined}
            onClick={canEdit ? () => navigate(`/me/memes/${m.id}/edit`) : undefined}
            onKeyDown={canEdit ? (e) => e.key === "Enter" && navigate(`/me/memes/${m.id}/edit`) : undefined}
            className={canEdit ? "cursor-pointer" : undefined}
          >
            <Artwork
              src={m.image_url || a.image_url}
              alt={m.caption}
              frame={frame}
              size="lg"
              // The crack marks favourites only in the «Мої меми» grid; here the meme stays clear.
              // Pressing ♥ plays the crack once and it fades away.
              crack={m.is_favorite && justLiked ? "fleeting" : null}
            />
          </div>
          <div className="mt-4 flex items-center gap-2">
            <IconButton icon="download" label="Завантажити" disabled={exporting.busy || !m.image_url} onClick={() => void exporting.run("download")} />
            <IconButton icon="share" label="Поділитися" onClick={share} />
            {canEdit && (
              <>
                <Button variant="soft" onClick={toggleSaved}>Видалити мем</Button>
                <IconButton icon="heart" label={m.is_favorite ? "Прибрати з улюблених" : "Додати до улюблених (скло трісне)"} active={m.is_favorite} onClick={toggleFavorite} />
              </>
            )}
          </div>
          <div className="mt-5">
            <FramePicker frame={frame} onFrameChange={canEdit ? changeFrame : undefined} withFrame={withFrame} onWithFrameChange={setWithFrame} />
          </div>
          {actionError && <ErrorMessage error={actionError} />}
          {exporting.error && <ErrorMessage error={exporting.error} />}
          {exporting.notice && <p role="status" className="t-small mt-3">{exporting.notice}</p>}
          {canEdit && <p className="t-small mt-4 text-text-secondary">Натисніть на мем, щоб змінити підпис.</p>}
          {isPublic && <ArtworkCardLink id={a.id} />}
        </div>
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
