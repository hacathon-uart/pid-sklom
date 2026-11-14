/** Screen 4b · Профіль — перегляд мему (US-08, US-16). Also used as the public share page /m/:id. */
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api/client";
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
  const toggleFavorite = async () => meme.setData(await api.updateMeme(m.id, { is_favorite: !m.is_favorite }));
  const remove = async () => {
    if (!confirm("Видалити цей мем?")) return;
    await api.deleteMeme(m.id);
    navigate("/me");
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
          {!isPublic && <IconButton icon="heart" label="Улюблене" active={m.is_favorite} onClick={toggleFavorite} />}
        </div>

        <div>
          <Artwork src={m.image_url ?? a.image_url} alt={m.caption} />
          {!isPublic && (
            <div className="mt-4 flex gap-3">
              <Button variant="secondary" onClick={() => navigate(`/me/memes/${m.id}/edit`)}>Редагувати</Button>
              <Button variant="soft" onClick={remove}>Видалити</Button>
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
