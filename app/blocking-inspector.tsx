"use client";

import { CELL, type MapDocument } from "./map-document";
import { getBlockingSettings, getItemBlocking, getItemPolygonPixels, isSimplePolygon, polygonContainsPolygon, supportsBlueprintPlacement } from "./blocking-model";
import "./blocking-inspector.css";

type DocumentProps = { document: MapDocument; onChange: (document: MapDocument) => void };
const format = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);

function NumberField({ label, value, onCommit, min = 0.01, max }: {
  label: string; value: number; onCommit: (value: number) => void; min?: number; max?: number;
}) {
  return <label className="blocking-field"><span>{label}</span><input key={value} type="number" step="any" min={Number.isFinite(min) ? min : undefined} max={max}
    defaultValue={value} onBlur={event => {
      const next = event.currentTarget.valueAsNumber;
      if (!Number.isFinite(next) || next < min || (max !== undefined && next > max)) { event.currentTarget.value = String(value); return; }
      if (next !== value) onCommit(next);
    }} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape") { event.currentTarget.value = String(value); event.currentTarget.blur(); }
      if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
    }} /></label>;
}

export function BlockingSettings({ document, onChange }: DocumentProps) {
  const settings = getBlockingSettings(document);
  const patch = (changes: Partial<typeof settings>) => onChange({ ...document, blocking: { ...settings, ...changes } });
  return <section className="blocking-panel" aria-label="Масштаб и геометрия">
    <h3>Масштаб и геометрия</h3>
    <NumberField label="Одна клетка, см" max={1e6} value={settings.centimetersPerCell} onCommit={centimetersPerCell => patch({ centimetersPerCell })} />
    <div className="blocking-row">
      <NumberField label="Глубина Y, см" min={0.1} max={1e6} value={settings.depthCm} onCommit={depthCm => patch({ depthCm })} />
      <NumberField label="Толщина стен, см" min={0.1} max={1e6} value={settings.wallThicknessCm} onCommit={wallThicknessCm => patch({ wallThicknessCm })} />
    </div>
    <details className="blocking-help"><summary>Как применяется масштаб</summary>
      <p className="blocking-hint">Клетка = {CELL} единицы холста: {format(settings.centimetersPerCell / CELL)} см на единицу. Приближение камеры масштаб не меняет.</p>
      <p className="blocking-hint">Эти размеры задают геометрию Unreal. Масштаб Blueprint настраивается в движке, состав выгрузки — в окне «Экспорт».</p>
    </details>
  </section>;
}

export function BlockingSelection({ document, onChange, itemIds }: DocumentProps & { itemIds: string[] }) {
  const selected = document.items.filter(item => itemIds.includes(item.id) && item.kind !== "transition");
  if (!selected.length) return null;
  const first = getItemBlocking(selected[0]);
  const sameRoom = selected.every(item => getItemBlocking(item).roomId?.toLowerCase() === first.roomId?.toLowerCase());
  const sameMode = selected.every(item => getItemBlocking(item).mode === first.mode);
  const settings = getBlockingSettings(document);
  const room = document.world.rooms.find(candidate => candidate.id.toLowerCase() === first.roomId?.toLowerCase());
  const hasRooms = selected.some(item => item.kind === "room");
  const hasObjects = selected.some(item => item.kind !== "room");
  const hasOneWay = selected.some(item => item.kind === "platform" && item.platformMode === "oneway");
  const hasMoving = selected.some(item => item.kind === "moving");
  const canPlaceBlueprints = selected.every(item => supportsBlueprintPlacement(item.kind));
  const patch = (changes: Partial<typeof first>) => {
    const ids = new Set(selected.map(item => item.id));
    onChange({ ...document, items: document.items.map(item => ids.has(item.id)
      ? { ...item, blocking: { ...getItemBlocking(item), ...changes } } : item) });
  };
  const points = selected.length === 1 ? getItemPolygonPixels(selected[0]) : [];
  const width = points.length ? Math.max(...points.map(point => point.x)) - Math.min(...points.map(point => point.x)) : 0;
  const height = points.length ? Math.max(...points.map(point => point.y)) - Math.min(...points.map(point => point.y)) : 0;
  return <section className="blocking-panel" aria-label="Выбранные объекты в Unreal">
    <h3>{selected.length > 1 ? `Объекты в Unreal · ${selected.length}` : "Объект в Unreal"}</h3>
    <label className="blocking-field"><span>Комната мира</span><select value={sameRoom ? room?.id ?? first.roomId ?? "" : "__mixed"}
      onChange={event => patch({ roomId: event.currentTarget.value || null })}>
      {!sameRoom && <option disabled value="__mixed">Разные комнаты</option>}
      <option value="">Не назначена</option>
      {sameRoom && first.roomId && !room && <option value={first.roomId}>Комната удалена — выберите другую</option>}
      {document.world.rooms.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
    </select></label>
    <label className="blocking-field"><span>Представление в Unreal</span><select value={sameMode ? first.mode : "__mixed"}
      onChange={event => patch({ mode: event.currentTarget.value as typeof first.mode })}>
      {!sameMode && <option disabled value="__mixed">Разные типы</option>}
      <option value="none">Не импортировать объект</option>
      <option value="solid" disabled={hasRooms || hasOneWay || hasMoving}>Сплошной блок с коллизией</option>
      <option value="outline" disabled={hasObjects}>Стены по контуру комнаты</option>
      <option value="blueprint" disabled={!canPlaceBlueprints}>Разместить Blueprint</option>
    </select></label>
    {hasRooms && hasObjects && <p className="blocking-hint">Комнату можно назначить всей группе; тип импорта задайте отдельно контурам и объектам.</p>}
    {hasOneWay && <p className="blocking-hint">OneWay использует Blueprint с опорой сверху и проходом снизу.</p>}
    {hasMoving && <p className="blocking-hint">Движение платформы нужно настроить в Blueprint.</p>}
    {selected.length === 1 && first.mode !== "blueprint" && <p className="blocking-dimensions">Габариты X × Z: <b>{format(width / CELL * settings.centimetersPerCell)} × {format(height / CELL * settings.centimetersPerCell)} см</b><br />Глубина Y: {format(settings.depthCm)} см</p>}
    {sameMode && first.mode !== "none" && sameRoom && !room && <p className="blocking-warning">Выберите существующую комнату мира для этого объекта.</p>}
    {sameMode && first.mode !== "none" && sameRoom && room && !room.blockingOrigin && <p className="blocking-warning">У комнаты «{room.name}» ещё не задано начало координат. Оно настраивается в свойствах комнаты мира.</p>}
    <details className="blocking-help"><summary>Правила импорта объекта</summary>
      <p className="blocking-hint">Принадлежность комнате сохраняется при перемещении объекта. «Следовать за контуром» её не меняет.</p>
      {hasOneWay && <p className="blocking-hint">Для OneWay сплошной блок недоступен. Режим и размеры платформы задаются в Blueprint.</p>}
      {hasMoving && <p className="blocking-hint">Якорь движущейся платформы — нижний центр рамки пути. Размеры, точки A/B и положение на пути автоматически в Blueprint не переносятся.</p>}
      {sameMode && first.mode === "outline" && <p className="blocking-hint">Стены создаются по сторонам «Стена» и «Ломаемая». «Дверь» и «Проход» остаются открытыми; дверь размещается отдельным объектом Blueprint.</p>}
      {sameMode && first.mode === "solid" && <p className="blocking-hint">Создаётся статический блок с коллизией. Движение, урон, вода и другая игровая логика не переносятся.</p>}
      {sameMode && first.mode === "blueprint" && <p className="blocking-hint">Якорь — нижний центр габаритов рисунка, глубина Y=0. Класс выбирается в импортёре Unreal. Blueprint сохраняет свой масштаб: растягивание рисунка меняет якорь, а не размер актора. Ключи, урон и другие игровые настройки не передаются.</p>}
    </details>
  </section>;
}

function getPreparation(document: MapDocument, roomId: string) {
  const room = document.world.rooms.find(candidate => candidate.id === roomId);
  const shape = document.items.find(item => item.id === room?.shapeItemId && item.kind === "room");
  if (!room || !shape) return null;
  const outline = getItemPolygonPixels(shape);
  if (!isSimplePolygon(outline)) return null;
  const roomOutlines = document.world.rooms.flatMap(candidate => {
    const candidateShape = document.items.find(item => item.id === candidate.shapeItemId && item.kind === "room");
    if (!candidateShape) return [];
    const polygon = getItemPolygonPixels(candidateShape);
    return isSimplePolygon(polygon) ? [{ roomId: candidate.id, shapeId: candidateShape.id, polygon }] : [];
  });
  const assignments = new Map<string, "outline" | "solid">();
  if (!shape.blocking && roomOutlines.filter(candidate => candidate.shapeId === shape.id).length === 1) assignments.set(shape.id, "outline");
  let ambiguous = 0;
  let preserved = 0;
  for (const item of document.items) {
    if (item.kind !== "platform" || (item.platformMode ?? "normal") !== "normal") continue;
    const polygon = getItemPolygonPixels(item);
    if (!polygonContainsPolygon(outline, polygon)) continue;
    if (item.blocking) { preserved += 1; continue; }
    const owners = roomOutlines.filter(candidate => polygonContainsPolygon(candidate.polygon, polygon));
    if (owners.length !== 1 || owners[0].roomId !== roomId) { ambiguous += 1; continue; }
    assignments.set(item.id, "solid");
  }
  return { shape, assignments, ambiguous, preserved, origin: { x: Math.min(...outline.map(point => point.x)), y: Math.max(...outline.map(point => point.y)) } };
}

export function RoomBlocking({ document, onChange, roomId }: DocumentProps & { roomId: string }) {
  const room = document.world.rooms.find(candidate => candidate.id === roomId);
  if (!room) return null;
  const preparation = getPreparation(document, roomId);
  const patchOrigin = (origin: { x: number; y: number }) => onChange({ ...document, world: { ...document.world,
    rooms: document.world.rooms.map(candidate => candidate.id === roomId ? { ...candidate, blockingOrigin: origin } : candidate) } });
  const count = document.items.filter(item => item.blocking?.roomId === roomId && item.blocking.mode !== "none").length;
  return <section className="blocking-panel" aria-label={`Блокинг комнаты ${room.name}`}>
    <h3>Начало координат блокинга</h3>
    {room.blockingOrigin ? <div className="blocking-row">
      <NumberField label="X, клетки" min={-Infinity} value={room.blockingOrigin.x / CELL}
        onCommit={x => patchOrigin({ ...room.blockingOrigin!, x: x * CELL })} />
      <NumberField label="Y вниз, клетки" min={-Infinity} value={room.blockingOrigin.y / CELL}
        onCommit={y => patchOrigin({ ...room.blockingOrigin!, y: y * CELL })} />
    </div> : <p className="blocking-warning">Начало ещё не задано. Эта точка холста станет X=0, Z=0 в карте комнаты.</p>}
    <div className="blocking-actions">
      <button type="button" disabled={!preparation} onClick={() => preparation && patchOrigin(preparation.origin)}>Из нижнего левого угла контура</button>
      {!room.blockingOrigin && <button type="button" onClick={() => patchOrigin({ x: 0, y: 0 })}>Задать X=0, Y=0</button>}
    </div>
    <details className="blocking-help"><summary>Система координат</summary>
      <p className="blocking-hint">X направлен вправо, Z — вверх, глубина Y симметрична нулю. Правка контура и карточки мира не сдвигает начало. Его изменение смещает весь блокинг комнаты в Unreal.</p>
    </details>
    {preparation && preparation.ambiguous > 0 && <p className="blocking-warning">В пересечении комнат пропущено объектов: {preparation.ambiguous}. Назначьте их вручную.</p>}
    <details className="blocking-help blocking-preparation"><summary>Подготовить существующий рисунок{preparation ? ` · ${preparation.assignments.size}` : ""}</summary>
    <p className="blocking-hint">Назначит контур как стены, а обычные платформы внутри него — как блоки. Платформы в пересечении нескольких комнат пропускаются.</p>
    {preparation ? <>
      <p className="blocking-dimensions">К назначению: <b>{preparation.assignments.size}</b> · Уже назначено: <b>{count}</b></p>
      {(preparation.preserved > 0 || preparation.shape.blocking) && <p className="blocking-hint">Существующие назначения и явно выключенные объекты сохраняются.</p>}
      <button type="button" className="blocking-prepare" disabled={!preparation.assignments.size && !!room.blockingOrigin} onClick={() => {
        onChange({ ...document,
          items: document.items.map(item => preparation.assignments.has(item.id)
            ? { ...item, blocking: { roomId, mode: preparation.assignments.get(item.id)! } } : item),
          world: { ...document.world, rooms: document.world.rooms.map(candidate => candidate.id === roomId
            ? { ...candidate, blockingOrigin: candidate.blockingOrigin ?? preparation.origin } : candidate) },
        });
      }}>Подготовить комнату · {preparation.assignments.size} объектов</button>
      {!room.blockingOrigin && <p className="blocking-hint">Подготовка также зафиксирует начало в нижнем левом углу контура: {format(preparation.origin.x / CELL)}, {format(preparation.origin.y / CELL)} клетки.</p>}
    </> : <p className="blocking-hint">Сначала привяжите простой, не пересекающий себя контур блокинга к этой комнате.</p>}
    </details>
  </section>;
}

export function BlockingOriginMarkers({ document }: { document: MapDocument }) {
  return document.world.rooms.filter(room => room.blockingOrigin).map(room => <div key={room.id}
    className="blocking-origin-marker" style={{ left: room.blockingOrigin!.x, top: room.blockingOrigin!.y }}
    title={`Начало координат комнаты ${room.name}`}><span>⊕</span><small>{room.name} · 0,0</small></div>);
}
