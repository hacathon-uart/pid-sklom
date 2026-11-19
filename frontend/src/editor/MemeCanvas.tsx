/**
 * The meme itself: painting + draggable caption blocks. Owner: B — T15, T28, T29.
 *
 * TODO(B): resize handles (Konva <Transformer>) that change block.width instead of scaling.
 */
import Konva from "konva";
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

const WATERMARK_FONT = '"Cormorant Garamond"';

export function MemeCanvas({ imageUrl, blocks, editable = false, active, onSelect, onBackgroundClick, onMove, stageRef }: Props) {
  // crossOrigin="anonymous" is REQUIRED, otherwise PNG export throws (tainted canvas).
  const [image, imageStatus] = useImage(imageUrl, "anonymous");
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [fontsReady, setFontsReady] = useState("");
  const [fontError, setFontError] = useState(false);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(0, el.clientWidth)));
    setWidth(Math.max(0, el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Konva measures text once; re-render after web fonts finish loading.
  const fontsKey = blocks.map((b) => b.font).join();
  useEffect(() => {
    let active = true;
    setFontError(false);
    Promise.all([
      ...blocks.map((b) => document.fonts.load(`${fontWeight(b.font)} 40px "${b.font}"`)),
      document.fonts.load(`italic 600 40px ${WATERMARK_FONT}`, "Під склом"),
    ])
      .then(() => { if (active) setFontsReady(fontsKey); })
      .catch(() => { if (active) setFontError(true); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontsKey]);

  // A canonical stage keeps rasterized PNG pixels independent of viewport width.
  // Only its DOM presentation scales; draft coordinates remain normalized.
  const height = image ? (REFERENCE_WIDTH * image.height) / image.width : (REFERENCE_WIDTH * 3) / 4;
  const displayScale = width / REFERENCE_WIDTH;

  const keepInside = (node: Konva.Text) => {
    node.x(Math.min(Math.max(0, node.x()), Math.max(0, REFERENCE_WIDTH - node.width())));
    node.y(Math.min(Math.max(0, node.y()), Math.max(0, height - node.height())));
  };

  return (
    <div ref={wrapRef} className="relative w-full" style={{ height: height * displayScale }}>
      <Stage
        exportReady={width > 0 && Boolean(image) && fontsReady === fontsKey && !fontError}
        exportError={imageStatus === "failed" || fontError}
        width={REFERENCE_WIDTH}
        height={height}
        style={{ position: "absolute", left: 0, top: 0, transform: `scale(${displayScale})`, transformOrigin: "top left", touchAction: editable ? "none" : "auto" }}
        ref={stageRef}
        onMouseDown={(e) => e.target === e.target.getStage() || e.target.name() === "bg" ? onBackgroundClick?.() : undefined}
        onTouchStart={(e) => e.target === e.target.getStage() || e.target.name() === "bg" ? onBackgroundClick?.() : undefined}
      >
        <Layer>
          {image && <KImage name="bg" image={image} width={REFERENCE_WIDTH} height={height} />}
          {blocks.map((b, i) => {
            const fontSize = b.size;
            const boxW = (b.width ?? 0.9) * REFERENCE_WIDTH;
            const boxH = measureCaptionHeight(b.text, b.font, fontSize, boxW);
            const x = b.x !== null ? b.x * REFERENCE_WIDTH : (REFERENCE_WIDTH - boxW) / 2;
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
                name="caption"
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
                strokeWidth={b.outline ? fontSize / 12 : 0}
                fillAfterStrokeEnabled
                draggable={editable}
                onMouseEnter={(e) => (e.target.getStage()!.container().style.cursor = "pointer")}
                onMouseLeave={(e) => (e.target.getStage()!.container().style.cursor = "")}
                shadowColor={editable && active === i ? "#C9B08F" : undefined}
                shadowBlur={editable && active === i ? 12 : 0}
                onMouseDown={() => onSelect?.(i)}
                onTouchStart={() => onSelect?.(i)}
                onDragMove={(e) => keepInside(e.target as Konva.Text)}
                onDragEnd={(e) => {
                  keepInside(e.target as Konva.Text);
                  onMove?.(i, e.target.x() / REFERENCE_WIDTH, e.target.y() / height);
                }}
              />
            );
          })}
          {/* Shown only during export (exportPng) — US-05 watermark */}
          <Text
            name="watermark"
            visible={false}
            text="Під склом"
            fontFamily="Cormorant Garamond" // same face as the «Під склом» title
            fontStyle="italic 600"
            fontSize={18}
            fill={blocks[0]?.color ?? "#FFFFFF"} // single colour, same as the caption
            width={140}
            align="right"
            x={REFERENCE_WIDTH - 148}
            y={height - 26}
          />
        </Layer>
      </Stage>
    </div>
  );
}

/** Measure with the same Konva text layout used for rendering. */
function measureCaptionHeight(text: string, font: string, fontSize: number, boxW: number) {
  const probe = new Konva.Text({
    text: text.toUpperCase(), width: boxW, fontFamily: font,
    fontStyle: String(fontWeight(font)), fontSize, lineHeight: 1.1,
  });
  const height = probe.height();
  probe.destroy();
  return height;
}
