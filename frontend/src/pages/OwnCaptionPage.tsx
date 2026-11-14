/** Screen 3d · Картина → свій підпис — fully manual meme (US-02, US-04). */
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api/client";
import { useApi } from "../api/useApi";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { ErrorMessage, Loading, Page } from "../components/Layout";
import { CaptionControls } from "../editor/CaptionControls";
import { MemeWorkspace, useSaveMeme } from "../editor/MemeWorkspace";
import { useMemeDraft } from "../editor/useMemeDraft";

export function OwnCaptionPage() {
  const artworkId = Number(useParams().artworkId);
  const navigate = useNavigate();
  const artwork = useApi(() => api.artwork(artworkId), [artworkId]);
  const draft = useMemeDraft("Ваш підпис тут", "top");
  const { stageRef, save, saving, error: saveError } = useSaveMeme((style, png) => api.createMeme(artworkId, style, png));

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
      actions={
        <>
          <Button variant="soft" onClick={() => navigate(-1)}>Скасувати</Button>
          <Button onClick={() => save(draft.style)} disabled={saving}>Зберегти в «Мої меми»</Button>
        </>
      }
    >
      {saveError && <ErrorMessage error={saveError} />}
      <MemeWorkspace
        artwork={artwork.data}
        story={artwork.data.story}
        draft={draft}
        editable
        stageRef={stageRef}
        onAnotherPainting={() => navigate("/create/painting")}
      >
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
      </MemeWorkspace>
    </Page>
  );
}
