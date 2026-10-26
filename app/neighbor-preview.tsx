"use client";

import { useId, useMemo } from "react";
import { getMovingPlatformLayout, type MapDocument, type PlacedItem, type Point } from "./map-document";
import { getNeighborFragments, previewPolygon } from "./neighbor-preview-model";
import "./neighbor-preview.css";

const pointsAttribute = (points: Point[]) => points.map(point => `${point.x},${point.y}`).join(" ");
const glyphs: Partial<Record<PlacedItem["kind"], string>> = { enemy: "!", boss: "!", checkpoint: "◈", loot: "▣", secret: "◇", door: "▥", ladder: "≡", goal: "◆", key: "⚿" };

function GhostItem({ item }: { item: PlacedItem }) {
  if (item.kind === "moving") {
    const layout = getMovingPlatformLayout(item), box = layout.platformBounds;
    return <g className="neighbor-moving"><path d={`M ${layout.start.x} ${layout.start.y} L ${layout.end.x} ${layout.end.y}`} stroke={item.color} strokeDasharray="8 8" /><rect x={box.x} y={box.y} width={box.width} height={box.height} fill={item.color} /></g>;
  }
  const color = item.kind === "platform" && item.platformMode === "oneway" ? "#7db8ee" : item.color;
  const polygon = previewPolygon(item), glyph = glyphs[item.kind];
  return <g className={`neighbor-item neighbor-${item.kind}`}>
    <polygon points={pointsAttribute(polygon)} fill={color} stroke={color} />
    {item.kind === "platform" && item.platformMode === "oneway" && <path d={`M ${item.x} ${item.y} h ${item.w * 32}`} stroke={color} strokeWidth="4" strokeDasharray="12 6" />}
    {glyph && <text x={item.x + item.w * 16} y={item.y + item.h * 16} textAnchor="middle" dominantBaseline="central" fill={color} fontSize={Math.min(28, item.h * 24)}>{glyph}</text>}
  </g>;
}

/** Mount inside the editor's transformed .world. It never participates in selection or export. */
export default function NeighborPreview({ document, roomId }: { document: MapDocument; roomId: string }) {
  const prefix = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const fragments = useMemo(() => getNeighborFragments(document, roomId), [document, roomId]);
  const room = document.world.rooms.find(room => room.id === roomId);
  const outline = document.items.find(item => item.id === room?.shapeItemId && item.kind === "room");
  if (!outline || !fragments.length) return null;
  const roomPolygon = previewPolygon(outline);
  return <svg className="neighbor-preview" aria-hidden="true" width="1" height="1">
    {fragments.map((fragment, index) => {
      const clipId = `${prefix}-neighbor-clip-${index}`, maskId = `${prefix}-neighbor-mask-${index}`;
      const xs = fragment.window.map(p => p.x), ys = fragment.window.map(p => p.y);
      const x = Math.min(...xs), y = Math.min(...ys), width = Math.max(...xs) - x, height = Math.max(...ys) - y;
      const separated = Math.hypot(fragment.source.x - fragment.anchor.x, fragment.source.y - fragment.anchor.y) > 1;
      return <g key={fragment.id} data-neighbor-room={fragment.roomId}>
        <defs>
          <clipPath id={clipId} clipPathUnits="userSpaceOnUse"><polygon points={pointsAttribute(fragment.window)} /></clipPath>
          <mask id={maskId} maskUnits="userSpaceOnUse" x={x - 1} y={y - 1} width={width + 2} height={height + 2}>
            <rect x={x - 1} y={y - 1} width={width + 2} height={height + 2} fill="white" />
            <polygon points={pointsAttribute(roomPolygon)} fill="black" />
          </mask>
        </defs>
        {separated && <path className="neighbor-tether" d={`M ${fragment.source.x} ${fragment.source.y} L ${fragment.anchor.x} ${fragment.anchor.y}`} />}
        <g clipPath={`url(#${clipId})`} mask={`url(#${maskId})`}>
          <polygon className="neighbor-window" points={pointsAttribute(fragment.window)} />
          <g className="neighbor-geometry" transform={`translate(${fragment.offset.x} ${fragment.offset.y})`}>
            {fragment.items.map(item => <GhostItem item={item} key={item.id} />)}
          </g>
          <text className="neighbor-name" x={x + width / 2} y={y + 24} textAnchor="middle">{fragment.roomName}</text>
          {fragment.incompatibleSides && <text className="neighbor-warning" x={x + width / 2} y={y + 46} textAnchor="middle">Разные стороны перехода</text>}
        </g>
      </g>;
    })}
  </svg>;
}
