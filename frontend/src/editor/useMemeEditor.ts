import type Konva from "konva";
import { useRef, useState } from "react";
import { api } from "../api/client";
import type { MemeStyle, Position } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { authEnabled } from "../auth/supabase";
import { read, remove, route, write } from "../auth/workflow";
import { exportPng } from "./exportPng";
import { useMemeDraft } from "./useMemeDraft";

interface SaveState {
  key: string;
  savedId: string | null;
  saving: boolean;
  error: string | null;
  justSaved: boolean;
}

/** Draft and save identity always use the same artwork-scoped creation flow. */
export function useMemeEditor(
  artworkId: number | null | undefined,
  { initialText = "", position = "bottom", memeId = null }: {
    initialText?: string;
    position?: Position;
    memeId?: string | null;
  } = {},
) {
  const scope = `artwork:${artworkId ?? "loading"}`;
  const draft = useMemeDraft(initialText, position, scope);
  const stageRef = useRef<Konva.Stage | null>(null);
  const { requireLogin, user } = useAuth();
  const saveKey = `saved:${user?.id}:${route()}:${scope}`;
  const initialState = (): SaveState => ({
    key: saveKey, savedId: memeId ?? read<string>(saveKey),
    saving: false, error: null, justSaved: false,
  });
  const [stored, setStored] = useState(initialState);
  const state = stored.key === saveKey ? stored : initialState();
  if (stored.key !== saveKey) setStored(state);
  const busy = useRef(new Set<string>());
  const intentKey = `save:${route()}:${scope}`;

  const updateState = (patch: Partial<SaveState>) => setStored((previous) =>
    previous.key === saveKey ? { ...previous, ...patch } : previous,
  );

  const saveIntent = () => {
    const style = draft.style;
    const previous = read<{ id: string; style: MemeStyle }>(intentKey);
    if (previous && JSON.stringify(previous.style) === JSON.stringify(style)) return previous;
    const intent = { id: crypto.randomUUID(), style };
    write(intentKey, intent);
    return intent;
  };

  const persist = async (intent: { id: string; style: MemeStyle }, favorite: boolean): Promise<string | null> => {
    if (busy.current.has(saveKey)) return null;
    busy.current.add(saveKey);
    updateState({ saving: true, error: null });
    try {
      const stage = stageRef.current;
      if (!stage?.getAttr("exportReady")) throw new Error("Зображення та шрифти ще завантажуються. Спробуйте ще раз");
      const png = exportPng(stage);
      const meme = state.savedId
        ? await api.updateMeme(state.savedId, { style: intent.style, image_data_url: png, ...(favorite ? { is_favorite: true } : {}) })
        : await api.createMeme(artworkId!, intent.style, png, intent.id);
      write(saveKey, meme.id);
      remove(intentKey);
      updateState({ savedId: meme.id, justSaved: true });
      if (favorite && !meme.is_favorite) await api.updateMeme(meme.id, { is_favorite: true });
      return meme.id;
    } catch (failure) {
      updateState({ error: failure instanceof Error ? failure.message : "Не вдалося виконати дію" });
      throw failure;
    } finally {
      busy.current.delete(saveKey);
      updateState({ saving: false });
    }
  };

  const save = () => {
    if (busy.current.has(saveKey)) return;
    if (!authEnabled || artworkId == null) {
      updateState({ error: "Збереження в акаунт поки недоступне. Завантажте мем як PNG" });
      return;
    }
    let intent: { id: string; style: MemeStyle };
    try {
      intent = saveIntent();
    } catch (failure) {
      updateState({ error: (failure as Error).message });
      return;
    }
    requireLogin(() => { void persist(intent, false).catch(() => {}); }, { kind: "save", route: route(), id: intent.id });
  };

  const share = async (): Promise<string> => {
    if (!authEnabled || !user || artworkId == null) throw new Error("Увійдіть, щоб поділитися мемом");
    if (busy.current.has(saveKey)) throw new Error("Дочекайтеся збереження мему");
    const id = await persist(saveIntent(), true);
    if (!id) throw new Error("Дочекайтеся збереження мему");
    return id;
  };

  return {
    draft, stageRef, save, share,
    savedId: state.savedId, saving: state.saving, error: state.error, justSaved: state.justSaved,
  };
}
