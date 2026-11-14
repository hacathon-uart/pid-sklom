import type Konva from "konva";

/** PNG data URL with the «Під склом» watermark, at roughly the source image resolution. */
export function exportPng(stage: Konva.Stage, targetWidth = 1200): string {
  const watermark = stage.findOne(".watermark");
  watermark?.visible(true);
  try {
    return stage.toDataURL({ mimeType: "image/png", pixelRatio: targetWidth / stage.width() });
  } finally {
    watermark?.visible(false);
  }
}

export function downloadDataUrl(dataUrl: string, filename = "pidsklom-meme.png") {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

/** Web Share API with file (mobile), falls back to copying the link. TODO(B, US-16). */
export async function shareMeme(dataUrl: string, url?: string) {
  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], "pidsklom-meme.png", { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: "Під склом" });
  } else if (url) {
    await navigator.clipboard.writeText(url);
    alert("Посилання скопійовано");
  } else {
    downloadDataUrl(dataUrl);
  }
}
