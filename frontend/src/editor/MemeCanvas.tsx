/**
 * The meme itself: painting + draggable caption blocks. Owner: B — T15, T28, T29.
 *
 * TODO(B):
 *  - resize handles (Konva <Transformer>) that change block.width instead of scaling
 *  - touch support check on phones (US-11)
 */
import type Konva from "konva";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Image as KImage, Layer, Stage, Text } from "react-konva";
import useImage from "use-image";
import type { TextBlock } from "../api/types";
import { fontWeight, REFERENCE_WIDTH } from "./model";

const MARGIN = 0.04;

interface Props {
  imageUrl: string;
  blocks: TextBlock[];
  editable?: boolean;
  active?: number;
  onSelect?: (index: number) => void;
  onBackgroundClick?: () => void;
  onMove?: (index: number, x: number, y: number) => void;
  stageRef?: RefObject<Konva.Stage | null>;
}

export function MemeCanvas({ imageUrl, blocks, editable = false, active, onSelect, onBackgroundClick, onMove, stageRef }: Props) {
  // crossOrigin="anonymous" is REQUIRED, otherwise PNG export throws (tainted canvas).
  const [image] = useImage(imageUrl, "anonymous");
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [, setFontsReady] = useState(0);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Konva measures text once; re-render after web fonts finish loading.
  const fontsKey = blocks.map((b) => b.font).join();
  useEffect(() => {
    Promise.all(blocks.map((b) => document.fonts.load(`${fontWeight(b.font)} 40px "${b.font}"`))).then(() =>
      setFontsReady((n) => n + 1),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontsKey]);

  const height = image ? (width * image.height) / image.width : (width * 3) / 4;
  const scale = width / REFERENCE_WIDTH;

  return (
    <div ref={wrapRef} className="w-full">
      <Stage
        width={width}
        height={height}
        ref={stageRef}
        onMouseDown={(e) => e.target === e.target.getStage() || e.target.name() === "bg" ? onBackgroundClick?.() : undefined}
        onTouchStart={(e) => e.target === e.target.getStage() || e.target.name() === "bg" ? onBackgroundClick?.() : undefined}
      >
        <Layer>
          {image && <KImage name="bg" image={image} width={width} height={height} />}
          {blocks.map((b, i) => {
            const fontSize = b.size * scale;
            const boxW = (b.width ?? 0.9) * width;
            const lines = Math.max(1, estimateLines(b.text, fontSize, boxW));
            const boxH = lines * fontSize * 1.1;
            const x = b.x !== null ? b.x * width : (width - boxW) / 2;
            const y =
              b.y !== null
                ? b.y * height
                : b.position === "top"
                  ? MARGIN * height
                  : b.position === "middle"
                    ? (height - boxH) / 2
                    : height - boxH - MARGIN * height;
            return (
              <Text
                key={i}
                text={b.text.toUpperCase()}
                x={x}
                y={y}
                width={boxW}
                align="center"
                fontFamily={b.font}
                fontStyle={String(fontWeight(b.font))}
                fontSize={fontSize}
                lineHeight={1.1}
                fill={b.color}
                stroke={b.outline ? "#000000" : undefined}
                strokeWidth={b.outline ? Math.max(2, fontSize / 12) : 0}
                fillAfterStrokeEnabled
                draggable
                onMouseEnter={(e) => (e.target.getStage()!.container().style.cursor = "pointer")}
                onMouseLeave={(e) => (e.target.getStage()!.container().style.cursor = "")}
                shadowColor={editable && active === i ? "#C9B08F" : undefined}
                shadowBlur={editable && active === i ? 12 : 0}
                onMouseDown={() => onSelect?.(i)}
                onTouchStart={() => onSelect?.(i)}
                onDragEnd={(e) => onMove?.(i, clamp01(e.target.x() / width), clamp01(e.target.y() / height))}
              />
            );
          })}
          {/* Shown only during export (exportPng) — US-05 watermark */}
          <Text
            name="watermark"
            visible={false}
            text="Під склом"
            fontFamily="Oswald"
            fontStyle="600"
            fontSize={12 * scale}
            fill="#FFFFFF"
            stroke="#000000"
            strokeWidth={0.5}
            x={width - 80 * scale}
            y={height - 20 * scale}
          />
        </Layer>
      </Stage>
    </div>
  );
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Rough line count for preset positioning (Konva wraps the real text itself). */
function estimateLines(text: string, fontSize: number, boxW: number) {
  const charsPerLine = Math.max(1, Math.floor(boxW / (fontSize * 0.5)));
  return Math.ceil(text.length / charsPerLine);
}
