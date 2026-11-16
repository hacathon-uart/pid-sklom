/** «Редагувати» from screen 4b: the editor (3b) preloaded with a saved meme; saving PATCHes it. */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { api } from "../api/client";
import { useApi } from "../api/useApi";
import { Button } from "../components/Button";
import { ErrorMessage, Loading, Page } from "../components/Layout";
import { CaptionControls } from "../editor/CaptionControls";
import { MemeWorkspace, SaveStatus, useSaveMeme } from "../editor/MemeWorkspace";
import { useMemeDraft } from "../editor/useMemeDraft";

export function EditMemePage() {
  const { memeId = "" } = useParams();
  const navigate = useNavigate();
  const meme = useApi(() => api.meme(memeId), [memeId]);
  const artworkId = meme.data?.artwork.id;
  const artwork = useApi(() => (artworkId ? api.artwork(artworkId) : Promise.resolve(null)), [artworkId]);
  const [editing, setEditing] = useState(true);
  const draft = useMemeDraft();
  const { stageRef, save, saving, error, savedId, justSaved, toggle } = useSaveMeme(
    (style, png) => api.createMeme(artworkId!, style, png),
    memeId,
  );

  useEffect(() => {
    if (meme.data) {
      draft.setBlocks(meme.data.style.blocks);
      draft.setFrame(meme.data.style.frame ?? "gold");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meme.data]);

  if (meme.loading || artwork.loading) return <Page title="Редагування"><Loading /></Page>;
  if (meme.error || !meme.data || !artwork.data) return <Page title="Редагування"><ErrorMessage error={meme.error ?? "Помилка"} /></Page>;

  return (
    <Page
      title="Редагування"
      subtitle="Перетягніть підпис на картині або змініть його стиль під нею"
      actions={
        <>
          <Button variant="soft" onClick={() => navigate(-1)}>Скасувати</Button>
          <Button onClick={() => save(draft.style)} disabled={saving}>Зберегти зміни</Button>
        </>
      }
    >
      <SaveStatus error={error} savedId={savedId} justSaved={justSaved} />
      <MemeWorkspace artwork={artwork.data} story={artwork.data.story} draft={draft} editing={editing} onEditingChange={setEditing} onSave={() => toggle(draft.style)}
        savedId={savedId} stageRef={stageRef}>
        {editing ? (
          <CaptionControls draft={draft} />
        ) : (
          <p className="t-small text-text-secondary">Натисніть на підпис на картині, щоб змінити його.</p>
        )}
      </MemeWorkspace>
    </Page>
  );
}
