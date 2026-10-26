import { CELL, getMovingPlatformLayout, type PlacedItem, type TrackOrientation } from "./map-document";

const format = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);

function NumberField({ label, value, max, onCommit }: { label: string; value: number; max?: number; onCommit: (value: number) => void }) {
  return <label>{label}<input key={value} type="number" min="0.01" max={max} step="any" defaultValue={value}
    onBlur={event => {
      const next = event.currentTarget.valueAsNumber;
      if (!Number.isFinite(next) || next <= 0 || (max !== undefined && next > max)) { event.currentTarget.value = String(value); return; }
      if (next !== value) onCommit(next);
    }} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape") { event.currentTarget.value = String(value); event.currentTarget.blur(); }
      if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
    }} /></label>;
}

export function MovingPlatformInspector({ item, onChange }: { item: PlacedItem; onChange: (changes: Partial<PlacedItem>) => void }) {
  const layout = getMovingPlatformLayout(item);
  const vertical = item.trackOrientation === "vertical";
  const position = item.trackPosition ?? .5;
  const commitPosition = (value: string) => {
    const percent = Number(value);
    if (percent === position * 100) return;
    const next = percent / 100;
    if (Number.isFinite(next) && next >= 0 && next <= 1 && next !== position) onChange({ trackPosition: next });
  };
  return <>
    <div className="field-row">
      <NumberField label="Платформа: ширина, кл." value={layout.widthCells} max={1024} onCommit={movingPlatformWidth => onChange({ movingPlatformWidth })} />
      <NumberField label="Платформа: высота, кл." value={layout.heightCells} max={1024} onCommit={movingPlatformHeight => onChange({ movingPlatformHeight })} />
    </div>
    <label>Направление движения<select value={item.trackOrientation ?? "horizontal"} onChange={event => {
      const trackOrientation = event.currentTarget.value as TrackOrientation;
      if (trackOrientation !== (item.trackOrientation ?? "horizontal")) onChange({ trackOrientation, w: item.h, h: item.w });
    }}>
      <option value="horizontal">Горизонтальное</option>
      <option value="vertical">Вертикальное</option>
    </select></label>
    <NumberField label="Длина пути A → B, кл." value={vertical ? item.h : item.w} onCommit={length => onChange(vertical ? { h: length } : { w: length })} />
    <label className="track-position-field">Положение на схеме A → B
      <input key={`${item.id}:${position}`} type="range" min="0" max="100" step="any" defaultValue={position * 100}
        onPointerUp={event => commitPosition(event.currentTarget.value)} onBlur={event => commitPosition(event.currentTarget.value)}
        onKeyUp={event => commitPosition(event.currentTarget.value)} />
      <span>{format(position * 100)}%</span>
    </label>
    <p className="blocking-dimensions">Центр A: {format(layout.start.x / CELL)}; {format(layout.start.y / CELL)} кл.<br />
      Центр B: {format(layout.end.x / CELL)}; {format(layout.end.y / CELL)} кл.</p>
    <p className="blocking-hint">A и B — крайние положения центра. Платформа показана в размере сетки и выходит за конец пути на половину своих габаритов. Это схема без анимации. В Unreal импортируется Blueprint у нижнего центра рамки пути; размеры платформы, положение на пути и движение нужно настроить в нём.</p>
  </>;
}
