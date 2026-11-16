import { useCallback, useState } from "react";
import type { Frame, MemeStyle, Position, TextBlock } from "../api/types";
import { MAX_BLOCKS, newBlock } from "./model";

/** Editor state shared by screens 3, 3b, 3c, 3d and 4b-edit. */
export function useMemeDraft(initialText = "", position: Position = "bottom") {
  const [blocks, setBlocks] = useState<TextBlock[]>([newBlock(initialText, position)]);
  const [active, setActive] = useState(0);
  const [frame, setFrame] = useState<Frame>("gold");

  const update = useCallback((index: number, patch: Partial<TextBlock>) => {
    setBlocks((bs) => bs.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  }, []);

  /** Change the main caption text (e.g. picking an AI caption) without touching style. */
  const setText = useCallback((text: string) => update(0, { text }), [update]);

  const addBlock = useCallback(() => {
    setBlocks((bs) => (bs.length >= MAX_BLOCKS ? bs : [...bs, newBlock("Ще текст", bs[0].position === "top" ? "bottom" : "top")]));
    setActive(1);
  }, []);

  const removeBlock = useCallback((index: number) => {
    setBlocks((bs) => (bs.length <= 1 ? bs : bs.filter((_, i) => i !== index)));
    setActive(0);
  }, []);

  const style: MemeStyle = { blocks, frame };
  return { blocks, setBlocks, active, setActive, update, setText, addBlock, removeBlock, frame, setFrame, style };
}

export type MemeDraft = ReturnType<typeof useMemeDraft>;
