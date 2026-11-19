import type Konva from "konva";
import type { Frame } from "../api/types";

/** PNG data URL with the «Під склом» watermark, at roughly the source image resolution. */
export function exportPng(stage: Konva.Stage, targetWidth = 1200): string {
  const watermark = stage.findOne(".watermark");
  const captions = stage.find(".caption") as Konva.Text[];
  const shadows = captions.map((node) => ({ node, blur: node.shadowBlur(), color: node.shadowColor() }));
  watermark?.visible(true);
  captions.forEach((node) => { node.shadowBlur(0); node.shadowColor("transparent"); });
  try {
    return stage.toDataURL({ mimeType: "image/png", pixelRatio: targetWidth / stage.width() });
  } finally {
    shadows.forEach(({ node, blur, color }) => { node.shadowBlur(blur); node.shadowColor(color); });
    watermark?.visible(false);
  }
}

export function downloadDataUrl(dataUrl: string, filename = "pidsklom-meme.png") {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

export async function urlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Не вдалося завантажити зображення мему");
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Не вдалося підготувати PNG"));
    reader.readAsDataURL(blob);
  });
}

export class ShareGestureRequired extends Error {}

/** Web Share API with file (mobile), with a download or explicit-link fallback. */
export async function shareMeme(dataUrl: string, url?: string) {
  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], "pidsklom-meme.png", { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    if (navigator.userActivation?.isActive === false) {
      throw new ShareGestureRequired("PNG готовий. Натисніть «Поділитися» ще раз, щоб відкрити меню.");
    }
    await navigator.share({ files: [file], title: "Під склом" });
  } else if (url) {
    await navigator.clipboard.writeText(url);
    alert("Посилання скопійовано");
  } else {
    downloadDataUrl(dataUrl);
  }
}

/**
 * «Завантажити з рамкою»: draws the picture frame (same look as the CSS frames in index.css)
 * around a frameless meme PNG. `src` is a data URL or a CORS-enabled image URL.
 */
export async function framePng(src: string, frame: Frame): Promise<string> {
  const img = await loadImage(src);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const u = W / 100; // 1% of the picture width
  const spec: Record<Frame, { outer: number; mat: number; matColor: string }> = {
    gold: { outer: 6 * u, mat: 4 * u, matColor: "#f4ecdc" },
    oak: { outer: 5.5 * u, mat: 4 * u, matColor: "#f4ecdc" },
    gallery: { outer: 1.6 * u, mat: 9 * u, matColor: "#fbfaf7" },
    mat: { outer: 0, mat: 4 * u, matColor: "#ffffff" },
  };
  const { outer: o, mat: m, matColor } = spec[frame];
  const cw = W + 2 * (o + m);
  const ch = H + 2 * (o + m);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cw);
  canvas.height = Math.round(ch);
  const ctx = canvas.getContext("2d")!;

  if (frame === "gold") {
    const g = ctx.createLinearGradient(0, 0, cw, ch);
    [["#6e4f17", 0], ["#e3bd62", 0.18], ["#a27a2a", 0.35], ["#f5dc93", 0.52], ["#8a6420", 0.7], ["#d9b356", 0.85], ["#5c4112", 1]].forEach(
      ([c, at]) => g.addColorStop(at as number, c as string),
    );
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);
    // bead moulding
    ctx.fillStyle = "rgba(255,238,190,.75)";
    const inset = o * 0.4;
    const step = u * 1.3;
    const r = Math.max(1, u * 0.2);
    for (let x = inset; x <= cw - inset; x += step) [inset, ch - inset].forEach((y) => dot(ctx, x, y, r));
    for (let y = inset; y <= ch - inset; y += step) [inset, cw - inset].forEach((x) => dot(ctx, x, y, r));
    bevel(ctx, cw, ch, o, "#4a340c", "#b8913c", u);
  } else if (frame === "oak") {
    const widths = [3, 4, 2, 5];
    const colors = ["#8a5a32", "#9b6a3e", "#7d5029", "#a5734a"];
    const k = Math.max(1, u / 3);
    for (let x = 0, i = 0; x < cw; x += widths[i % 4] * k, i++) {
      ctx.fillStyle = colors[i % 4];
      ctx.fillRect(x, 0, widths[i % 4] * k + 0.5, ch);
    }
    bevel(ctx, cw, ch, o, "#4c2f17", "rgba(255,255,255,.18)", u);
  } else if (frame === "gallery") {
    ctx.fillStyle = "#151311";
    ctx.fillRect(0, 0, cw, ch);
  }

  ctx.fillStyle = matColor;
  ctx.fillRect(o, o, cw - 2 * o, ch - 2 * o);
  if (frame === "mat") {
    ctx.strokeStyle = "#C9B08F";
    ctx.lineWidth = Math.max(1, u * 0.15);
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, cw - ctx.lineWidth, ch - ctx.lineWidth);
  }
  ctx.drawImage(img, o + m, o + m, W, H);
  ctx.strokeStyle = "rgba(0,0,0,.25)";
  ctx.lineWidth = Math.max(1, u * 0.12);
  ctx.strokeRect(o + m, o + m, W, H);
  return canvas.toDataURL("image/png");
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Не вдалося завантажити зображення мему"));
    img.src = src;
  });
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Dark outer edge + light inner lip of the moulding. */
function bevel(ctx: CanvasRenderingContext2D, cw: number, ch: number, o: number, dark: string, light: string, u: number) {
  ctx.lineWidth = Math.max(1, u * 0.25);
  ctx.strokeStyle = dark;
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, cw - ctx.lineWidth, ch - ctx.lineWidth);
  ctx.strokeRect(o - ctx.lineWidth / 2, o - ctx.lineWidth / 2, cw - 2 * o + ctx.lineWidth, ch - 2 * o + ctx.lineWidth);
  ctx.strokeStyle = light;
  ctx.strokeRect(o - ctx.lineWidth * 1.5, o - ctx.lineWidth * 1.5, cw - 2 * o + ctx.lineWidth * 3, ch - 2 * o + ctx.lineWidth * 3);
}
