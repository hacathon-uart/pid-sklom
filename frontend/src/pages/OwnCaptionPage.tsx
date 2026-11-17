/** Screen 3d · Картина → свій підпис — fully manual meme (US-02, US-04). */
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api/client";
import { useApi } from "../api/useApi";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { ErrorMessage, Loading, Page } from "../components/Layout";
import { CaptionControls } from "../editor/CaptionControls";
import { MemeWorkspace, SaveStatus, useSaveMeme } from "../editor/MemeWorkspace";
import { useMemeDraft } from "../editor/useMemeDraft";

export function OwnCaptionPage() {
  const artworkId = Number(useParams().artworkId);
  const navigate = useNavigate();
  const artwork = useApi(() => api.artwork(artworkId), [artworkId]);
  const [editing, setEditing] = useState(true);
  const draft = useMemeDraft("Ваш підпис тут", "top");
  const { stageRef, error: saveError, savedId, justSaved, toggle } = useSaveMeme((style, png, intent) => api.createMeme(artworkId, style, png, intent));

  const back = (
    <Link to={`/create/painting?artwork=${artworkId}`} className="t-strong flex items-center gap-2 text-accent">
      <Icon name="arrowLeft" size={18} /> Обрати іншу картину
    </Link>
  );

  if (artwork.loading) return <Page title="Свій підпис" back={back}><Loading /></Page>;
  if (artwork.error || !artwork.data)
    return <Page title="Свій підпис" back={back}><ErrorMessage error={artwork.error ?? "Помилка"} onRetry={artwork.reload} /></Page>;

  return (
    <Page
      title="Свій підпис"
      subtitle="Напишіть підпис самі. Історія картини вже поруч, може, вона підкаже ідею."
      back={back}
      actions={<Button variant="soft" onClick={() => navigate(-1)}>Скасувати</Button>}
    >
      <SaveStatus error={saveError} savedId={savedId} justSaved={justSaved} />
      <MemeWorkspace
        artwork={artwork.data}
        story={artwork.data.story}
        draft={draft}
        editing={editing}
        onEditingChange={setEditing}
        onSave={() => toggle(draft.style)}
        savedId={savedId}
        stageRef={stageRef}
        onAnotherPainting={() => navigate("/create/painting")}
      >
        {!editing ? (
          <p className="t-small text-text-secondary">Натисніть на підпис на картині, щоб змінити його.</p>
        ) : (
        <CaptionControls
          draft={draft}
          hint={
            <>
              Немає ідей?{" "}
              <Link to={`/create/painting/${artworkId}/ai`} className="font-semibold text-accent">
                Запропонувати підписи від ШІ →
              </Link>
            </>
          }
        />
        )}
      </MemeWorkspace>
    </Page>
  );
}
