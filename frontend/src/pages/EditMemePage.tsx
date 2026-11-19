/** «Редагувати» from screen 4b: the editor (3b) preloaded with a saved meme; saving PATCHes it. */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { api } from "../api/client";
import { useApi } from "../api/useApi";
import { Button } from "../components/Button";
import { ErrorMessage, Loading, Page } from "../components/Layout";
import { CaptionControls } from "../editor/CaptionControls";
import { MemeWorkspace, SaveStatus } from "../editor/MemeWorkspace";
import { useMemeEditor } from "../editor/useMemeEditor";

export function EditMemePage() {
  const { memeId = "" } = useParams();
  const navigate = useNavigate();
  const meme = useApi(() => api.meme(memeId), [memeId]);
  const artworkId = meme.data?.artwork.id;
  const artwork = useApi(() => (artworkId ? api.artwork(artworkId) : Promise.resolve(null)), [artworkId]);
  const [editing, setEditing] = useState(true);
  const { draft, stageRef, save, saving, error, savedId, justSaved } = useMemeEditor(artworkId, { memeId });

  useEffect(() => {
    if (meme.data && !draft.restored) {
      draft.setBlocks(meme.data.style.blocks);
      draft.setFrame(meme.data.style.frame ?? "gold");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meme.data]);

  if (meme.loading || artwork.loading) return <Page title="Редагування"><Loading /></Page>;
  if (meme.error || !meme.data) return <Page title="Редагування"><ErrorMessage error={meme.error ?? "Помилка"} onRetry={meme.reload} /></Page>;
  if (artwork.error || !artwork.data) return <Page title="Редагування"><ErrorMessage error={artwork.error ?? "Не вдалося завантажити картину"} onRetry={artwork.reload} /></Page>;
  if (!meme.data.can_edit) return <Page title="Редагування"><ErrorMessage error="Мем не знайдено у вашій колекції" /></Page>;

  return (
    <Page
      title="Редагування"
      subtitle="Перетягніть підпис або змініть його стиль"
    >
      <SaveStatus error={error} savedId={savedId} justSaved={justSaved} />
      <MemeWorkspace artwork={artwork.data} story={artwork.data.story ? { status: "ready", story: artwork.data.story } : { status: "unavailable" }} draft={draft} editing={editing} onEditingChange={setEditing} onSave={save}
        savedId={savedId} stageRef={stageRef}
        toolbarEnd={
          <>
            <Button variant="soft" onClick={() => navigate(`/me/memes/${memeId}`)}>До мему</Button>
            <Button onClick={save} disabled={saving}>Зберегти зміни</Button>
          </>
        }>
        {editing ? (
          <CaptionControls draft={draft} />
        ) : (
          <p className="t-small text-text-secondary">Натисніть на підпис, щоб змінити його.</p>
        )}
      </MemeWorkspace>
    </Page>
  );
}
