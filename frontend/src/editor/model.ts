import type { Position, TextBlock } from "../api/types";

/** TextBlock.size is in px for an image this wide. Same constant in backend/app/render/meme.py. */
export const REFERENCE_WIDTH = 600;
export const MAX_BLOCKS = 2;

/** Meme fonts — all with Cyrillic. Must match backend/app/render/fonts (FONT_FILES). */
export const MEME_FONTS = [
  { name: "Oswald", weight: 600 },
  { name: "Rubik", weight: 700 },
  { name: "Montserrat", weight: 800 },
  { name: "Lobster", weight: 400 },
  { name: "Comfortaa", weight: 700 },
] as const;

export const MEME_COLORS = ["#FFFFFF", "#2E2620", "#EFE6D8", "#8B6B4A", "#C9B08F"];

export const POSITION_LABELS: Record<Position, string> = { top: "Вгорі", middle: "Посередині", bottom: "Внизу" };

export function newBlock(text: string, position: Position = "bottom"): TextBlock {
  return { text, font: "Oswald", size: 40, color: "#FFFFFF", outline: true, position, x: null, y: null, width: null };
}

export function fontWeight(font: string): number {
  return MEME_FONTS.find((f) => f.name === font)?.weight ?? 600;
}

export function describeStyle(b: TextBlock): string {
  return `${b.font} · ${b.size} px · ${b.outline ? "з обведенням" : "без обведення"} · ${POSITION_LABELS[b.position].toLowerCase()}`;
}
