import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Frame, MemeStyle, Position, TextBlock } from "../api/types";
import { MAX_BLOCKS, newBlock } from "./model";
import { read, route, useTabState } from "../auth/workflow";

/** Editor state shared by screens 3, 3b, 3c, 3d and 4b-edit. */
export function useMemeDraft(initialText = "", position: Position = "bottom", scope = "") {
  const currentRoute = route();
  const key = scope ? `${scope}:` : "";
  const inherited = useRef<{ route: string; blocks: TextBlock[]; frame: Frame }>({
    route: currentRoute, blocks: [newBlock(initialText, position)], frame: "gold",
  });
  const initial = inherited.current.route === currentRoute
    ? inherited.current
    : { blocks: [newBlock(initialText, position)], frame: "gold" as const };
  const restored = useMemo(() => read(`draft:${currentRoute}:${key}blocks`) !== null, [currentRoute, key]);
  const [blocks, setBlocks] = useTabState<TextBlock[]>(`${key}blocks`, initial.blocks);
  const [active, setActive] = useState(0);
  const [frame, setFrame] = useTabState<Frame>(`${key}frame`, initial.frame);
  useLayoutEffect(() => { inherited.current = { route: currentRoute, blocks, frame }; }, [currentRoute, blocks, frame]);

  const update = useCallback((index: number, patch: Partial<TextBlock>) => {
    setBlocks((bs) => bs.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  }, [setBlocks]);

  /** Change the main caption text (e.g. picking an AI caption) without touching style. */
  const setText = useCallback((text: string) => update(0, { text }), [update]);

  const addBlock = useCallback(() => {
    setBlocks((bs) => (bs.length >= MAX_BLOCKS ? bs : [...bs, newBlock("Ще текст", bs[0].position === "top" ? "bottom" : "top")]));
    setActive(1);
  }, [setBlocks]);

  const removeBlock = useCallback((index: number) => {
    setBlocks((bs) => (bs.length <= 1 ? bs : bs.filter((_, i) => i !== index)));
    setActive(0);
  }, [setBlocks]);

  const style: MemeStyle = { blocks, frame };
  return { blocks, setBlocks, active: Math.min(active, blocks.length - 1), setActive, update, setText, addBlock, removeBlock, frame, setFrame, style, restored };
}

export type MemeDraft = ReturnType<typeof useMemeDraft>;
