/** Screen 4b · Профіль — перегляд мему (US-08, US-16). Also used as the public share page /m/:id. */
import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api/client";
import type { Frame } from "../api/types";
import { useApi } from "../api/useApi";
import { Artwork } from "../components/Artwork";
import { Button, IconButton } from "../components/Button";
import { years } from "../components/cards";
import { Icon } from "../components/Icon";
import { copyPublicMemeUrl, copyShareUrl, ShareLinkPanel } from "../components/ShareLinkPanel";
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
  const mutationLock = useRef(false);
  const [updating, setUpdating] = useState(false);
  const [shareLink, setShareLink] = useState<{ url: string; copied: boolean } | null>(null);
  const [sharing, setSharing] = useState(false);
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

  const back = (
    <Link to={isPublic ? "/gallery" : "/me"} className="t-strong flex min-h-11 items-center gap-2 text-accent">
      <Icon name="arrowLeft" size={18} /> {isPublic ? "Галерея" : "Мої меми"}
    </Link>
  );

  if (meme.loading) return <Page title={isPublic ? "Мем" : "Мій мем"} back={back}><Loading /></Page>;
  if (meme.error || !meme.data) return <Page title={isPublic ? "Мем" : "Мій мем"} back={back}><ErrorMessage error={meme.error ?? "Помилка"} onRetry={meme.reload} /></Page>;

  const m = meme.data;
  const a = m.artwork;
  const toggleFavorite = async () => {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setUpdating(true);
    try {
      setActionError(null);
      setJustLiked(!m.is_favorite);
      meme.setData(await api.updateMeme(m.id, { is_favorite: !m.is_favorite }));
    } catch (failure) { setActionError((failure as Error).message); }
    finally { mutationLock.current = false; setUpdating(false); }
  };
  const canEdit = !isPublic && m.can_edit;
  const frame: Frame = m.style.frame ?? "gold";
  const changeFrame = async (f: Frame) => {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setUpdating(true);
    const style = { ...m.style, frame: f };
    try {
      setActionError(null);
      meme.setData(await api.updateMeme(m.id, { style }));
    } catch (failure) { setActionError((failure as Error).message); }
    finally { mutationLock.current = false; setUpdating(false); }
  };
  const toggleSaved = async () => {
    if (mutationLock.current) return;
    if (!window.confirm("Видалити мем? Посилання перестане працювати.")) return;
    mutationLock.current = true;
    setUpdating(true);
    setActionError(null);
    try {
      await api.deleteMeme(m.id);
      forgetSaved(m.id);
      navigate("/me", { replace: true });
    } catch (e) {
      setActionError((e as Error).message);
    } finally { mutationLock.current = false; setUpdating(false); }
  };
  const share = async () => {
    if (mutationLock.current || !canEdit) return;
    mutationLock.current = true;
    setShareLink(null);
    setActionError(null);
    setSharing(true);
    try {
      if (!m.is_favorite) meme.setData(await api.updateMeme(m.id, { is_favorite: true }));
      setShareLink(await copyPublicMemeUrl(m.id));
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : "Не вдалося підготувати посилання");
    } finally { mutationLock.current = false; setSharing(false); }
  };
  const savedOn = new Date(m.created_at).toLocaleDateString("uk-UA", { day: "numeric", month: "long", year: "numeric" });

  return (
    <Page title={isPublic ? "Мем" : "Мій мем"} subtitle={`Збережено ${savedOn}`} back={back}>
      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-14">
        <div className="min-w-0 [overflow-wrap:anywhere]">
          {/* The caption is part of the PNG, so the whole picture is the click target for editing. */}
          <div
            role={canEdit ? "button" : undefined}
            tabIndex={canEdit ? 0 : undefined}
            aria-label={canEdit ? "Редагувати підпис" : undefined}
            title={canEdit ? "Натисніть, щоб змінити підпис" : undefined}
            onClick={canEdit ? () => navigate(`/me/memes/${m.id}/edit`) : undefined}
            onKeyDown={canEdit ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                navigate(`/me/memes/${m.id}/edit`);
              }
            } : undefined}
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
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {canEdit && (
              <>
                <IconButton icon="bookmark" label="Прибрати з «Моїх мемів»" active aria-pressed disabled={updating} onClick={toggleSaved} />
                <IconButton icon="heart" label={m.is_favorite ? "Прибрати з улюблених" : "Додати до улюблених"} active={m.is_favorite} aria-pressed={m.is_favorite} disabled={updating} onClick={toggleFavorite} />
              </>
            )}
            <IconButton icon="download" label="Завантажити" disabled={updating || exporting.busy || !m.image_url} onClick={() => void exporting.run()} />
            {canEdit && <Button variant="secondary" className="min-h-11 whitespace-normal" disabled={sharing || updating} onClick={share}>{sharing ? "Готуємо посилання…" : "Поділитися посиланням"}</Button>}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            {canEdit && <Link to={`/me/memes/${m.id}/edit`} className="t-strong inline-flex min-h-11 items-center text-accent">Редагувати підпис →</Link>}
            <a href="#meme-story" className="t-strong inline-flex min-h-11 items-center text-accent">Про картину ↓</a>
          </div>
          <fieldset disabled={updating} className="mt-5 min-w-0 border-0 p-0 [&_label]:min-h-11 [&_[role=radiogroup]]:flex-wrap">
            <legend className="sr-only">Рамка та завантаження</legend>
            <FramePicker frame={frame} onFrameChange={canEdit ? changeFrame : undefined} withFrame={withFrame} onWithFrameChange={setWithFrame} />
          </fieldset>
          {shareLink && <ShareLinkPanel {...shareLink} onCopy={() => {
            void copyShareUrl(shareLink.url).then((copied) => setShareLink((current) => current?.url === shareLink.url ? { ...current, copied } : current));
          }} onClose={() => setShareLink(null)} />}
          {actionError && <ErrorMessage error={actionError} />}
          {exporting.error && <ErrorMessage error={exporting.error} />}
          {isPublic && <ArtworkCardLink id={a.id} />}
        </div>
        <section id="meme-story" tabIndex={-1} aria-label="Про картину та автора" className="min-w-0 scroll-mt-6 [overflow-wrap:anywhere]">
          <div className="flex items-center gap-4 md:gap-5">
            <Portrait src={a.artist.portrait_url} name={a.artist.name} />
            <div className="min-w-0 [overflow-wrap:anywhere]">
              <h2 className="t-h2 text-3xl md:text-4xl">{a.artist.name}</h2>
              <div className="t-small text-text-secondary">
                {years(a.artist)} · «{a.title}»{a.year ? `, ${a.year}` : ""}
              </div>
            </div>
          </div>
          {detail.loading && <Loading text="Завантаження історії…" />}
          {detail.error && <ErrorMessage error={detail.error} onRetry={detail.reload} />}
          {detail.data && (
            <>
              <h3 className="t-h3 mt-8">Про картину</h3>
              <p className="t-body mt-2 text-text-secondary">{detail.data.story.about_artwork}</p>
              {detail.data.story.artist_fact && (
                <>
                  <h3 className="t-h3 mt-6">Про автора</h3>
                  <p className="t-body mt-2 text-text-secondary">{detail.data.story.artist_fact.text}</p>
                </>
              )}
            </>
          )}
          {artist.data && (
            <section className="mt-12">
              <div className="t-label mb-4">Ще від цього автора</div>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {artist.data.artworks.filter((w) => w.id !== a.id).slice(0, 4).map((w) => (
                  <Link key={w.id} to={`/create/painting?artwork=${w.id}`}>
                    <Artwork src={w.thumb_url} alt={w.title} aspect="4/5" />
                  </Link>
                ))}
              </div>
              <Link to={`/artists/${a.artist.slug}`} className="t-strong mt-4 inline-flex min-h-11 items-center text-accent">Сторінка автора →</Link>
            </section>
          )}
        </section>

      </div>
    </Page>
  );
}

function ArtworkCardLink({ id }: { id: number }) {
  return (
    <Link to={`/create/painting?artwork=${id}`} className="t-strong mt-4 flex min-h-11 items-center justify-center rounded-control bg-accent px-4 py-3 text-center text-white sm:inline-flex">
      Зробити свій мем
    </Link>
  );
}
