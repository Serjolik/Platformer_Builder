"use client";

import { DragEvent, PointerEvent as ReactPointerEvent, WheelEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Tool = "select" | "line" | "arrow";
type PrimitiveKind = "enemy" | "boss" | "player" | "npc" | "platform" | "moving" | "hazard" | "ladder" | "vine" | "room" | "spawn" | "goal" | "note" | "key" | "door" | "secret" | "checkpoint" | "comment" | "liquid";
type Point = { x: number; y: number };
type SideType = "straight" | "waves" | "door" | "opening";
type PlatformMode = "normal" | "crumble" | "damage";
type HazardDirection = "up" | "down" | "left" | "right";
type PathMode = "line" | "rail";
type EnemyType = "normal" | "heavy";
type NpcRole = "npc" | "merchant";
type TrackOrientation = "horizontal" | "vertical";
type MapLayer = { id: string; name: string; visible: boolean; locked: boolean };
type PlacedItem = Point & { id: string; kind: PrimitiveKind; label: string; color: string; w: number; h: number; layerId?: string; trackPosition?: number; trackOrientation?: TrackOrientation; keyName?: string; polygonPoints?: Point[]; sideTypes?: SideType[]; platformMode?: PlatformMode; hazardDirection?: HazardDirection; enemyType?: EnemyType; npcRole?: NpcRole };
type PathItem = { id: string; kind: "line" | "arrow"; from: Point; to: Point; control?: Point; color: string; pathMode?: PathMode; layerId?: string };
type MapDocument = { version: 1; name: string; grid: number; items: PlacedItem[]; paths: PathItem[]; layers: MapLayer[]; inactiveLayerOpacity: number };
type ResizeDirection = "n" | "e" | "s" | "w";
type Gesture = {
  mode: "pan" | "item" | "path" | "resize" | "marquee" | "track-position" | "path-move" | "path-handle" | "polygon-vertex" | "room-side-extrude";
  start: Point;
  origin: Point;
  itemId?: string;
  itemSnapshot?: PlacedItem;
  itemSnapshots?: PlacedItem[];
  pathSnapshot?: PathItem;
  pathSnapshots?: PathItem[];
  pathHandle?: "from" | "to" | "control";
  vertexIndex?: number;
  sideIndex?: number;
  direction?: ResizeDirection;
  didMove?: boolean;
  cycleOnClick?: boolean;
  clickPoint?: Point;
};
type Marquee = { from: Point; to: Point; additive: boolean };
type ClipboardPayload = { items: PlacedItem[]; paths: PathItem[]; anchor: Point };

const CELL = 32;
const STORAGE_KEY = "blockout-map-v1";
const BACKGROUND_LAYER_ID = "layer-background";
const GAMEPLAY_LAYER_ID = "layer-gameplay";
const defaultLayers = (): MapLayer[] => [
  { id: BACKGROUND_LAYER_ID, name: "Фон", visible: true, locked: false },
  { id: GAMEPLAY_LAYER_ID, name: "Геймплей", visible: true, locked: false },
];
const palette: { title: string; items: Array<{ kind: PrimitiveKind; label: string; icon: string; color: string; w: number; h: number; enemyType?: EnemyType; npcRole?: NpcRole }> }[] = [
  { title: "ПРОТИВНИКИ", items: [
    { kind: "enemy", label: "Обычный враг", icon: "◆", color: "#ff655d", w: 1, h: 1, enemyType: "normal" },
    { kind: "enemy", label: "Тяжёлый враг", icon: "⬢", color: "#d84c60", w: 1, h: 1, enemyType: "heavy" },
    { kind: "boss", label: "ИМЯ БОССА", icon: "♛", color: "#b94f72", w: 3, h: 3 },
  ]},
  { title: "ПЕРСОНАЖИ", items: [
    { kind: "player", label: "Персонаж", icon: "●", color: "#68b8ff", w: 1, h: 2 },
    { kind: "npc", label: "Дружественный NPC", icon: "○", color: "#77d8a1", w: 1, h: 2, npcRole: "npc" },
    { kind: "npc", label: "Торговец", icon: "¤", color: "#e0b765", w: 1, h: 2, npcRole: "merchant" },
  ]},
  { title: "ГЕОМЕТРИЯ", items: [
    { kind: "platform", label: "Платформа", icon: "▬", color: "#53c7be", w: 4, h: 1 },
    { kind: "moving", label: "Трек платформы", icon: "━", color: "#f2b84b", w: 6, h: 1 },
    { kind: "hazard", label: "Опасность", icon: "▲", color: "#f07845", w: 3, h: 1 },
    { kind: "liquid", label: "Зона жидкости", icon: "≈", color: "#46aee8", w: 6, h: 3 },
    { kind: "room", label: "Форма комнаты", icon: "▱", color: "#8fa4b8", w: 8, h: 5 },
    { kind: "ladder", label: "Лестница", icon: "╫", color: "#c28d55", w: 1, h: 1 },
    { kind: "vine", label: "Лиана", icon: "⌇", color: "#63b96a", w: 1, h: 5 },
  ]},
  { title: "ЛОГИКА", items: [
    { kind: "spawn", label: "Точка старта", icon: "●", color: "#74d477", w: 2, h: 2 },
    { kind: "goal", label: "Цель", icon: "⚑", color: "#9a7cff", w: 2, h: 2 },
    { kind: "checkpoint", label: "Скамейка-чекпоинт", icon: "▰", color: "#77c7d8", w: 2, h: 1 },
    { kind: "key", label: "Ключ", icon: "K", color: "#62a8ff", w: 1, h: 1 },
    { kind: "door", label: "Дверь", icon: "▥", color: "#8b949e", w: 1, h: 3 },
    { kind: "secret", label: "Секретная стенка", icon: "┆", color: "#8b949e", w: 4, h: 2 },
    { kind: "comment", label: "Комментарий зоны", icon: "□", color: "#7897bc", w: 6, h: 4 },
    { kind: "note", label: "Заметка", icon: "T", color: "#aeb8c4", w: 3, h: 2 },
  ]},
];

const emptyDocument = (): MapDocument => ({ version: 1, name: "Новая локация", grid: CELL, items: [], paths: [], layers: defaultLayers(), inactiveLayerOpacity: .32 });
const id = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const normalizeDocument = (document: Partial<MapDocument>): MapDocument => {
  const layers = Array.isArray(document.layers) && document.layers.length ? document.layers : defaultLayers();
  const fallbackLayerId = layers.some(layer => layer.id === GAMEPLAY_LAYER_ID) ? GAMEPLAY_LAYER_ID : layers[layers.length - 1].id;
  return {
    version: 1,
    name: document.name ?? "Новая локация",
    grid: CELL,
    layers,
    inactiveLayerOpacity: typeof document.inactiveLayerOpacity === "number" ? Math.min(1, Math.max(.05, document.inactiveLayerOpacity)) : .32,
    items: Array.isArray(document.items) ? document.items.map(item => ({ ...item, layerId: item.layerId ?? fallbackLayerId })) : [],
    paths: Array.isArray(document.paths) ? document.paths.map(path => ({ ...path, layerId: path.layerId ?? fallbackLayerId })) : [],
  };
};
const snap = (value: number) => Math.round(value / CELL) * CELL;
const pathControl = (path: PathItem): Point => path.control ?? { x: (path.from.x + path.to.x) / 2, y: (path.from.y + path.to.y) / 2 };
const pathData = (path: PathItem) => {
  const control = pathControl(path);
  return `M ${path.from.x} ${path.from.y} Q ${control.x} ${control.y} ${path.to.x} ${path.to.y}`;
};
const pathTouchesRect = (path: PathItem, left: number, right: number, top: number, bottom: number) => {
  const control = pathControl(path);
  const padding = 6;
  for (let index = 0; index <= 48; index += 1) {
    const t = index / 48;
    const inverse = 1 - t;
    const point = {
      x: inverse * inverse * path.from.x + 2 * inverse * t * control.x + t * t * path.to.x,
      y: inverse * inverse * path.from.y + 2 * inverse * t * control.y + t * t * path.to.y,
    };
    if (point.x >= left - padding && point.x <= right + padding && point.y >= top - padding && point.y <= bottom + padding) return true;
  }
  return false;
};
const pathTouchesPoint = (path: PathItem, point: Point, tolerance: number) => {
  const control = pathControl(path);
  let previous = path.from;
  for (let index = 1; index <= 64; index += 1) {
    const t = index / 64;
    const inverse = 1 - t;
    const current = {
      x: inverse * inverse * path.from.x + 2 * inverse * t * control.x + t * t * path.to.x,
      y: inverse * inverse * path.from.y + 2 * inverse * t * control.y + t * t * path.to.y,
    };
    const segment = { x: current.x - previous.x, y: current.y - previous.y };
    const segmentLengthSquared = segment.x * segment.x + segment.y * segment.y;
    const projection = segmentLengthSquared === 0 ? 0 : Math.min(1, Math.max(0,
      ((point.x - previous.x) * segment.x + (point.y - previous.y) * segment.y) / segmentLengthSquared,
    ));
    const closest = { x: previous.x + segment.x * projection, y: previous.y + segment.y * projection };
    if (Math.hypot(point.x - closest.x, point.y - closest.y) <= tolerance) return true;
    previous = current;
  }
  return false;
};
const pointOnPath = (path: PathItem, t: number) => {
  const control = pathControl(path);
  const inverse = 1 - t;
  const point = {
    x: inverse * inverse * path.from.x + 2 * inverse * t * control.x + t * t * path.to.x,
    y: inverse * inverse * path.from.y + 2 * inverse * t * control.y + t * t * path.to.y,
  };
  const tangent = {
    x: 2 * inverse * (control.x - path.from.x) + 2 * t * (path.to.x - control.x),
    y: 2 * inverse * (control.y - path.from.y) + 2 * t * (path.to.y - control.y),
  };
  return { ...point, angle: Math.atan2(tangent.y, tangent.x) * 180 / Math.PI };
};
const railArrows = (path: PathItem) => {
  const control = pathControl(path);
  const approximateLength = Math.hypot(control.x - path.from.x, control.y - path.from.y) + Math.hypot(path.to.x - control.x, path.to.y - control.y);
  const count = Math.max(2, Math.min(14, Math.floor(approximateLength / 48)));
  return Array.from({ length: count }, (_, index) => pointOnPath(path, (index + 1) / (count + 1)));
};
const polygonPoints = (item: PlacedItem): Point[] => item.polygonPoints ?? [
  { x: 0, y: 0 }, { x: item.w * CELL, y: 0 }, { x: item.w * CELL, y: item.h * CELL }, { x: 0, y: item.h * CELL },
];
const pointInPolygon = (point: Point, points: Point[]) => {
  let inside = false;
  for (let current = 0, previous = points.length - 1; current < points.length; previous = current++) {
    const a = points[current];
    const b = points[previous];
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || Number.EPSILON) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
};
const itemContainsPoint = (item: PlacedItem, point: Point) => {
  if (item.kind === "room" || item.kind === "liquid") {
    return pointInPolygon({ x: point.x - item.x, y: point.y - item.y }, polygonPoints(item));
  }
  return point.x >= item.x && point.x <= item.x + item.w * CELL && point.y >= item.y && point.y <= item.y + item.h * CELL;
};
const sidePathData = (from: Point, to: Point, type: SideType) => {
  if (type === "straight") return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const segments = Math.max(2, Math.round(length / (CELL * .7)));
  const normal = { x: -dy / length, y: dx / length };
  let data = `M ${from.x} ${from.y}`;
  for (let index = 0; index < segments; index += 1) {
    const startRatio = index / segments;
    const endRatio = (index + 1) / segments;
    const middleRatio = (startRatio + endRatio) / 2;
    const amplitude = (index % 2 === 0 ? 1 : -1) * 6;
    const control = { x: from.x + dx * middleRatio + normal.x * amplitude, y: from.y + dy * middleRatio + normal.y * amplitude };
    const end = { x: from.x + dx * endRatio, y: from.y + dy * endRatio };
    data += ` Q ${control.x} ${control.y} ${end.x} ${end.y}`;
  }
  return data;
};
const keyColor = (keyName = "Key_A") => {
  let hash = 0;
  for (const character of keyName) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 72% 62%)`;
};
const itemColor = (item: PlacedItem, items: PlacedItem[] = []) => {
  if (item.kind === "platform" && item.platformMode === "crumble") return "#d9a55b";
  if (item.kind === "platform" && item.platformMode === "damage") return "#ef6254";
  if (item.kind === "key") return keyColor(item.keyName);
  if (item.kind === "door") {
    const linked = Boolean(item.keyName && items.some(candidate => candidate.kind === "key" && (candidate.keyName ?? "Key_A") === item.keyName));
    return linked ? keyColor(item.keyName) : "#8b949e";
  }
  return item.color;
};

export default function MapEditor() {
  const [doc, setDoc] = useState<MapDocument>(emptyDocument);
  const [activeLayerId, setActiveLayerId] = useState(GAMEPLAY_LAYER_ID);
  const [tool, setTool] = useState<Tool>("select");
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const [pan, setPan] = useState<Point>({ x: 480, y: 300 });
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedSide, setSelectedSide] = useState<{ itemId: string; index: number } | null>(null);
  const [selectedVertex, setSelectedVertex] = useState<{ itemId: string; index: number } | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [draftPath, setDraftPath] = useState<PathItem | null>(null);
  const [history, setHistory] = useState<MapDocument[]>([]);
  const [future, setFuture] = useState<MapDocument[]>([]);
  const [saved, setSaved] = useState(true);
  const viewportRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const clipboardRef = useRef<ClipboardPayload | null>(null);
  const cursorWorldRef = useRef<Point>({ x: 0, y: 0 });
  const docRef = useRef<MapDocument>(doc);

  useEffect(() => { docRef.current = doc; }, [doc]);

  useEffect(() => {
    if (!doc.layers.some(layer => layer.id === activeLayerId && layer.visible && !layer.locked)) {
      setActiveLayerId(doc.layers.find(layer => layer.visible && !layer.locked)?.id ?? doc.layers[0]?.id ?? GAMEPLAY_LAYER_ID);
    }
  }, [activeLayerId, doc.layers]);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const restored = normalizeDocument(JSON.parse(raw) as Partial<MapDocument>);
        docRef.current = restored;
        setDoc(restored);
        setActiveLayerId(restored.layers.find(layer => layer.id === GAMEPLAY_LAYER_ID && layer.visible && !layer.locked)?.id ?? restored.layers.find(layer => layer.visible && !layer.locked)?.id ?? restored.layers[0].id);
      } catch { /* Keep a clean document. */ }
    }
  }, []);

  const commit = useCallback((next: MapDocument | ((current: MapDocument) => MapDocument)) => {
    const current = docRef.current;
    const value = typeof next === "function" ? next(current) : next;
    setHistory(h => [...h.slice(-39), current]);
    setFuture([]);
    setSaved(false);
    docRef.current = value;
    setDoc(value);
  }, []);

  const updateItemLive = useCallback((itemId: string, changes: Partial<PlacedItem>) => {
    const current = docRef.current;
    const next = { ...current, items: current.items.map(item => item.id === itemId ? { ...item, ...changes } : item) };
    docRef.current = next;
    setDoc(next);
    setSaved(false);
  }, []);

  const updatePathLive = useCallback((pathId: string, updater: (path: PathItem) => PathItem) => {
    const current = docRef.current;
    const next = { ...current, paths: current.paths.map(path => path.id === pathId ? updater(path) : path) };
    docRef.current = next;
    setDoc(next);
    setSaved(false);
  }, []);

  const save = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
    setSaved(true);
  }, [doc]);

  useEffect(() => {
    const timer = window.setTimeout(save, 700);
    return () => window.clearTimeout(timer);
  }, [doc, save]);

  const undo = useCallback(() => {
    if (!history.length) return;
    const previous = history[history.length - 1];
    setFuture(f => [docRef.current, ...f].slice(0, 40));
    setHistory(history.slice(0, -1));
    docRef.current = previous;
    setDoc(previous);
    setSelected([]);
    setSelectedSide(null);
    setSelectedVertex(null);
    setSaved(false);
  }, [history]);

  const redo = useCallback(() => {
    if (!future.length) return;
    const next = future[0];
    setHistory(h => [...h, docRef.current].slice(-40));
    setFuture(future.slice(1));
    docRef.current = next;
    setDoc(next);
    setSelected([]);
    setSelectedSide(null);
    setSelectedVertex(null);
    setSaved(false);
  }, [future]);

  const removeSelected = useCallback(() => {
    if (!selected.length) return;
    const selectedIds = new Set(selected);
    commit(current => ({ ...current, items: current.items.filter(item => !selectedIds.has(item.id)), paths: current.paths.filter(path => !selectedIds.has(path.id)) }));
    setSelected([]);
    setSelectedSide(null);
    setSelectedVertex(null);
  }, [commit, selected]);

  const removeSelectedVertex = useCallback(() => {
    if (!selectedVertex) return;
    const target = docRef.current.items.find(item => item.id === selectedVertex.itemId && item.kind === "room");
    if (!target) return;
    const points = polygonPoints(target).map(point => ({ ...point }));
    if (points.length <= 3 || selectedVertex.index < 0 || selectedVertex.index >= points.length) return;
    points.splice(selectedVertex.index, 1);
    const sideTypes = Array.from({ length: points.length + 1 }, (_, index) => target.sideTypes?.[index] ?? "straight") as SideType[];
    sideTypes.splice(selectedVertex.index, 1);
    const minX = Math.min(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y));
    const maxX = Math.max(...points.map(point => point.x));
    const maxY = Math.max(...points.map(point => point.y));
    commit(current => ({ ...current, items: current.items.map(item => item.id === target.id ? {
      ...item,
      x: target.x + minX,
      y: target.y + minY,
      w: Math.max(1, Math.ceil((maxX - minX) / CELL)),
      h: Math.max(1, Math.ceil((maxY - minY) / CELL)),
      polygonPoints: points.map(point => ({ x: point.x - minX, y: point.y - minY })),
      sideTypes,
    } : item) }));
    setSelectedVertex(null);
    setSelectedSide(null);
  }, [commit, selectedVertex]);

  const copySelected = useCallback(() => {
    if (!selected.length) return;
    const selectedIds = new Set(selected);
    const items = docRef.current.items.filter(item => selectedIds.has(item.id)).map(item => structuredClone(item));
    const paths = docRef.current.paths.filter(path => selectedIds.has(path.id)).map(path => structuredClone(path));
    const bounds: Point[] = [];
    items.forEach(item => bounds.push({ x: item.x, y: item.y }, { x: item.x + item.w * CELL, y: item.y + item.h * CELL }));
    paths.forEach(path => bounds.push(path.from, path.to, pathControl(path)));
    if (!bounds.length) return;
    const left = Math.min(...bounds.map(point => point.x));
    const right = Math.max(...bounds.map(point => point.x));
    const top = Math.min(...bounds.map(point => point.y));
    const bottom = Math.max(...bounds.map(point => point.y));
    clipboardRef.current = { items, paths, anchor: { x: (left + right) / 2, y: (top + bottom) / 2 } };
  }, [selected]);

  const pasteClipboard = useCallback(() => {
    const clipboard = clipboardRef.current;
    if (!clipboard) return;
    const delta = {
      x: snap(cursorWorldRef.current.x - clipboard.anchor.x),
      y: snap(cursorWorldRef.current.y - clipboard.anchor.y),
    };
    const items = clipboard.items.map(item => ({ ...structuredClone(item), id: id(), layerId: activeLayerId, x: item.x + delta.x, y: item.y + delta.y }));
    const paths = clipboard.paths.map(path => ({
      ...structuredClone(path), id: id(), layerId: activeLayerId,
      from: { x: path.from.x + delta.x, y: path.from.y + delta.y },
      to: { x: path.to.x + delta.x, y: path.to.y + delta.y },
      control: path.control ? { x: path.control.x + delta.x, y: path.control.y + delta.y } : undefined,
    }));
    commit(current => ({ ...current, items: [...current.items, ...items], paths: [...current.paths, ...paths] }));
    setSelected([...items.map(item => item.id), ...paths.map(path => path.id)]);
    setSelectedSide(null);
    setSelectedVertex(null);
  }, [activeLayerId, commit]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable) return;
      const command = event.ctrlKey || event.metaKey;
      if (command && event.code === "KeyZ") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      if (command && event.code === "KeyY") { event.preventDefault(); redo(); }
      if (command && event.code === "KeyS") { event.preventDefault(); save(); }
      if (command && event.code === "KeyC") { event.preventDefault(); copySelected(); }
      if (command && event.code === "KeyV") { event.preventDefault(); pasteClipboard(); }
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); selectedVertex ? removeSelectedVertex() : removeSelected(); }
      if (event.key === "Escape") { setDraftPath(null); setMarquee(null); setSelected([]); setSelectedSide(null); setSelectedVertex(null); setTool("select"); }
      if (event.key === "1") setTool("select");
      if (event.key === "2") setTool("line");
      if (event.key === "3") setTool("arrow");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [copySelected, pasteClipboard, redo, removeSelected, removeSelectedVertex, save, selectedVertex, undo]);

  const screenToWorld = (clientX: number, clientY: number) => {
    const rect = viewportRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left - pan.x) / zoom, y: (clientY - rect.top - pan.y) / zoom };
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = viewportRef.current!.getBoundingClientRect();
    const cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const nextZoom = Math.min(2.5, Math.max(.25, zoom * (event.deltaY > 0 ? .9 : 1.1)));
    const world = { x: (cursor.x - pan.x) / zoom, y: (cursor.y - pan.y) / zoom };
    cursorWorldRef.current = world;
    setPan({ x: cursor.x - world.x * nextZoom, y: cursor.y - world.y * nextZoom });
    setZoom(nextZoom);
  };

  const onViewportDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    cursorWorldRef.current = screenToWorld(event.clientX, event.clientY);
    if (event.button === 2 || event.button === 1) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = { mode: "pan", start: { x: event.clientX, y: event.clientY }, origin: pan };
      return;
    }
    if ((tool === "line" || tool === "arrow") && event.button === 0) {
      const world = screenToWorld(event.clientX, event.clientY);
      const point = { x: snap(world.x), y: snap(world.y) };
      const path: PathItem = { id: id(), kind: tool, from: point, to: point, color: tool === "arrow" ? "#f2b84b" : "#c8d1dc", layerId: activeLayerId };
      gesture.current = { mode: "path", start: point, origin: point };
      setDraftPath(path);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (tool === "select" && event.button === 0) {
      const world = screenToWorld(event.clientX, event.clientY);
      if (!event.shiftKey) { setSelected([]); setSelectedSide(null); setSelectedVertex(null); }
      setMarquee({ from: world, to: world, additive: event.shiftKey });
      gesture.current = { mode: "marquee", start: world, origin: world };
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    cursorWorldRef.current = screenToWorld(event.clientX, event.clientY);
    const current = gesture.current;
    if (!current) return;
    if (current.mode === "pan") setPan({ x: current.origin.x + event.clientX - current.start.x, y: current.origin.y + event.clientY - current.start.y });
    if (current.mode === "path") {
      const world = screenToWorld(event.clientX, event.clientY);
      setDraftPath(path => path ? { ...path, to: { x: snap(world.x), y: snap(world.y) } } : null);
    }
    if (current.mode === "marquee") {
      const world = screenToWorld(event.clientX, event.clientY);
      setMarquee(value => value ? { ...value, to: world } : null);
    }
    if (current.mode === "item" && (current.itemSnapshots || current.pathSnapshots)) {
      const world = screenToWorld(event.clientX, event.clientY);
      const delta = { x: snap(world.x - current.start.x), y: snap(world.y - current.start.y) };
      if (Math.hypot(world.x - current.start.x, world.y - current.start.y) * zoom > 4) current.didMove = true;
      const snapshots = new Map((current.itemSnapshots ?? []).map(item => [item.id, item]));
      const pathSnapshots = new Map((current.pathSnapshots ?? []).map(path => [path.id, path]));
      const value = docRef.current;
      const next = { ...value, items: value.items.map(item => {
        const original = snapshots.get(item.id);
        return original ? { ...item, x: original.x + delta.x, y: original.y + delta.y } : item;
      }), paths: value.paths.map(path => {
        const original = pathSnapshots.get(path.id);
        return original ? {
          ...path,
          from: { x: original.from.x + delta.x, y: original.from.y + delta.y },
          to: { x: original.to.x + delta.x, y: original.to.y + delta.y },
          control: original.control ? { x: original.control.x + delta.x, y: original.control.y + delta.y } : undefined,
        } : path;
      }) };
      docRef.current = next;
      setDoc(next);
      setSaved(false);
    }
    if (current.mode === "track-position" && current.itemId && current.itemSnapshot) {
      const world = screenToWorld(event.clientX, event.clientY);
      const track = current.itemSnapshot;
      const trackPosition = track.trackOrientation === "vertical"
        ? Math.min(1, Math.max(0, (world.y - track.y) / (track.h * CELL)))
        : Math.min(1, Math.max(0, (world.x - track.x) / (track.w * CELL)));
      updateItemLive(track.id, { trackPosition });
    }
    if (current.mode === "path-move" && current.pathSnapshot) {
      const world = screenToWorld(event.clientX, event.clientY);
      const original = current.pathSnapshot;
      const delta = { x: snap(world.x - current.start.x), y: snap(world.y - current.start.y) };
      updatePathLive(original.id, path => ({
        ...path,
        from: { x: original.from.x + delta.x, y: original.from.y + delta.y },
        to: { x: original.to.x + delta.x, y: original.to.y + delta.y },
        control: original.control ? { x: original.control.x + delta.x, y: original.control.y + delta.y } : undefined,
      }));
    }
    if (current.mode === "path-handle" && current.pathSnapshot && current.pathHandle) {
      const world = screenToWorld(event.clientX, event.clientY);
      const step = current.pathHandle === "control" ? CELL / 2 : CELL;
      const point = { x: Math.round(world.x / step) * step, y: Math.round(world.y / step) * step };
      updatePathLive(current.pathSnapshot.id, path => current.pathHandle === "control"
        ? { ...path, control: point }
        : { ...path, [current.pathHandle!]: point });
    }
    if (current.mode === "polygon-vertex" && current.itemSnapshot && current.vertexIndex !== undefined) {
      const world = screenToWorld(event.clientX, event.clientY);
      const original = current.itemSnapshot;
      const step = CELL / 2;
      const movedWorld = { x: Math.round(world.x / step) * step, y: Math.round(world.y / step) * step };
      const points = polygonPoints(original).map((point, index) => index === current.vertexIndex
        ? { x: movedWorld.x - original.x, y: movedWorld.y - original.y }
        : { ...point });
      const minX = Math.min(...points.map(point => point.x));
      const minY = Math.min(...points.map(point => point.y));
      const maxX = Math.max(...points.map(point => point.x));
      const maxY = Math.max(...points.map(point => point.y));
      const normalized = points.map(point => ({ x: point.x - minX, y: point.y - minY }));
      updateItemLive(original.id, {
        x: original.x + minX,
        y: original.y + minY,
        w: Math.max(1, Math.ceil((maxX - minX) / CELL)),
        h: Math.max(1, Math.ceil((maxY - minY) / CELL)),
        polygonPoints: normalized,
      });
    }
    if (current.mode === "room-side-extrude" && current.itemSnapshot && current.sideIndex !== undefined) {
      const world = screenToWorld(event.clientX, event.clientY);
      const original = current.itemSnapshot;
      const originalPoints = polygonPoints(original).map(point => ({ ...point }));
      const sideIndex = current.sideIndex;
      const from = originalPoints[sideIndex];
      const to = originalPoints[(sideIndex + 1) % originalPoints.length];
      const pointerDelta = { x: world.x - current.start.x, y: world.y - current.start.y };
      const step = CELL / 2;
      const offset = {
        x: Math.round(pointerDelta.x / step) * step,
        y: Math.round(pointerDelta.y / step) * step,
      };

      if (offset.x === 0 && offset.y === 0) {
        updateItemLive(original.id, {
          x: original.x, y: original.y, w: original.w, h: original.h,
          polygonPoints: originalPoints,
          sideTypes: original.sideTypes,
        });
        setSelectedSide({ itemId: original.id, index: sideIndex });
      } else {
        const movedFrom = {
          x: from.x + offset.x,
          y: from.y + offset.y,
        };
        const movedTo = {
          x: to.x + offset.x,
          y: to.y + offset.y,
        };
        const points = originalPoints.map(point => ({ ...point }));
        points.splice(sideIndex + 1, 0, movedFrom, movedTo);
        const originalTypes = Array.from({ length: originalPoints.length }, (_, index) => original.sideTypes?.[index] ?? "straight") as SideType[];
        const extrudedType = originalTypes[sideIndex] ?? "straight";
        originalTypes.splice(sideIndex, 1, "straight", extrudedType, "straight");
        const minX = Math.min(...points.map(point => point.x));
        const minY = Math.min(...points.map(point => point.y));
        const maxX = Math.max(...points.map(point => point.x));
        const maxY = Math.max(...points.map(point => point.y));
        updateItemLive(original.id, {
          x: original.x + minX,
          y: original.y + minY,
          w: Math.max(1, Math.ceil((maxX - minX) / CELL)),
          h: Math.max(1, Math.ceil((maxY - minY) / CELL)),
          polygonPoints: points.map(point => ({ x: point.x - minX, y: point.y - minY })),
          sideTypes: originalTypes,
        });
        setSelectedSide({ itemId: original.id, index: sideIndex + 1 });
      }
    }
    if (current.mode === "resize" && current.itemId && current.itemSnapshot && current.direction) {
      const world = screenToWorld(event.clientX, event.clientY);
      const original = current.itemSnapshot;
      const right = original.x + original.w * CELL;
      const bottom = original.y + original.h * CELL;
      let resized = { ...original };

      if (current.direction === "e") resized.w = Math.max(1, Math.round((world.x - original.x) / CELL));
      if (current.direction === "s") resized.h = Math.max(1, Math.round((world.y - original.y) / CELL));
      if (current.direction === "w") {
        resized.x = Math.min(snap(world.x), right - CELL);
        resized.w = Math.max(1, Math.round((right - resized.x) / CELL));
      }
      if (current.direction === "n") {
        resized.y = Math.min(snap(world.y), bottom - CELL);
        resized.h = Math.max(1, Math.round((bottom - resized.y) / CELL));
      }

      const value = docRef.current;
      const next = { ...value, items: value.items.map(item => item.id === current.itemId ? resized : item) };
      docRef.current = next;
      setDoc(next);
      setSaved(false);
    }
  };

  const selectableEntitiesAtPoint = (point: Point) => {
    const currentDocument = docRef.current;
    const items = currentDocument.items
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => {
        const layer = currentDocument.layers.find(entry => entry.id === (candidate.layerId ?? GAMEPLAY_LAYER_ID));
        return layer?.visible && !layer.locked && itemContainsPoint(candidate, point);
      })
      .sort((a, b) => {
        const aLayer = currentDocument.layers.findIndex(layer => layer.id === (a.candidate.layerId ?? GAMEPLAY_LAYER_ID));
        const bLayer = currentDocument.layers.findIndex(layer => layer.id === (b.candidate.layerId ?? GAMEPLAY_LAYER_ID));
        return bLayer - aLayer || b.index - a.index;
      })
      .map(({ candidate }) => candidate);
    const paths = currentDocument.paths
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => {
        const layer = currentDocument.layers.find(entry => entry.id === (candidate.layerId ?? GAMEPLAY_LAYER_ID));
        return layer?.visible && !layer.locked && pathTouchesPoint(candidate, point, 10 / zoom);
      })
      .sort((a, b) => {
        const aLayer = currentDocument.layers.findIndex(layer => layer.id === (a.candidate.layerId ?? GAMEPLAY_LAYER_ID));
        const bLayer = currentDocument.layers.findIndex(layer => layer.id === (b.candidate.layerId ?? GAMEPLAY_LAYER_ID));
        return bLayer - aLayer || b.index - a.index;
      })
      .map(({ candidate }) => candidate);
    return [...items, ...paths];
  };

  const onPointerUp = () => {
    const current = gesture.current;
    if (current?.mode === "path" && draftPath && (draftPath.from.x !== draftPath.to.x || draftPath.from.y !== draftPath.to.y)) commit(value => ({ ...value, paths: [...value.paths, draftPath] }));
    if (current?.mode === "marquee" && marquee) {
      const left = Math.min(marquee.from.x, marquee.to.x);
      const right = Math.max(marquee.from.x, marquee.to.x);
      const top = Math.min(marquee.from.y, marquee.to.y);
      const bottom = Math.max(marquee.from.y, marquee.to.y);
      const selectableLayers = new Set(docRef.current.layers.filter(layer => layer.visible && !layer.locked).map(layer => layer.id));
      const itemHits = docRef.current.items.filter(item => selectableLayers.has(item.layerId ?? GAMEPLAY_LAYER_ID) && item.x < right && item.x + item.w * CELL > left && item.y < bottom && item.y + item.h * CELL > top).map(item => item.id);
      const pathHits = docRef.current.paths.filter(path => selectableLayers.has(path.layerId ?? GAMEPLAY_LAYER_ID) && pathTouchesRect(path, left, right, top, bottom)).map(path => path.id);
      const hits = [...itemHits, ...pathHits];
      setSelected(currentSelection => marquee.additive ? Array.from(new Set([...currentSelection, ...hits])) : hits);
      setSelectedVertex(null);
    }
    if (current?.mode === "item" && current.cycleOnClick && !current.didMove && current.clickPoint && current.itemId) {
      const candidates = selectableEntitiesAtPoint(current.clickPoint);
      const currentIndex = candidates.findIndex(candidate => candidate.id === current.itemId);
      if (currentIndex >= 0 && candidates.length > 1) {
        const nextItem = candidates[(currentIndex + 1) % candidates.length];
        setSelected([nextItem.id]);
        setActiveLayerId(nextItem.layerId ?? GAMEPLAY_LAYER_ID);
      }
    }
    gesture.current = null;
    setDraftPath(null);
    setMarquee(null);
  };

  const startItemDrag = (event: ReactPointerEvent, item: PlacedItem) => {
    if (tool !== "select" || event.button !== 0) return;
    if (docRef.current.layers.find(layer => layer.id === (item.layerId ?? GAMEPLAY_LAYER_ID))?.locked) return;
    event.stopPropagation();
    setSelectedSide(null);
    setSelectedVertex(null);
    const world = screenToWorld(event.clientX, event.clientY);
    let dragEntity: PlacedItem | PathItem = item;
    if (!event.shiftKey && selected.length === 1) {
      const selectedItemAtPoint = docRef.current.items.find(candidate => candidate.id === selected[0] && itemContainsPoint(candidate, world));
      const selectedPathAtPoint = docRef.current.paths.find(candidate => candidate.id === selected[0] && pathTouchesPoint(candidate, world, 10 / zoom));
      if (selectedItemAtPoint) dragEntity = selectedItemAtPoint;
      else if (selectedPathAtPoint) dragEntity = selectedPathAtPoint;
    }
    const cycleOnClick = !event.shiftKey && selected.length === 1 && selected[0] === dragEntity.id;
    setActiveLayerId(dragEntity.layerId ?? GAMEPLAY_LAYER_ID);
    const activeIds = event.shiftKey
      ? Array.from(new Set([...selected, dragEntity.id]))
      : selected.length > 1 && selected.includes(item.id) ? selected : [dragEntity.id];
    setSelected(activeIds);
    const itemSnapshots = docRef.current.items.filter(candidate => activeIds.includes(candidate.id)).map(candidate => ({ ...candidate }));
    const pathSnapshots = docRef.current.paths.filter(candidate => activeIds.includes(candidate.id)).map(candidate => ({ ...candidate, from: { ...candidate.from }, to: { ...candidate.to }, control: candidate.control ? { ...candidate.control } : undefined }));
    const origin = "from" in dragEntity ? dragEntity.from : { x: dragEntity.x, y: dragEntity.y };
    gesture.current = { mode: "item", itemId: dragEntity.id, start: world, origin, itemSnapshots, pathSnapshots, cycleOnClick, clickPoint: world };
    viewportRef.current?.setPointerCapture(event.pointerId);
    setHistory(h => [...h.slice(-39), docRef.current]);
    setFuture([]);
  };

  const startResize = (event: ReactPointerEvent, item: PlacedItem, direction: ResizeDirection) => {
    if (tool !== "select" || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelected([item.id]);
    const world = screenToWorld(event.clientX, event.clientY);
    gesture.current = { mode: "resize", itemId: item.id, start: world, origin: { x: item.x, y: item.y }, itemSnapshot: { ...item }, direction };
    viewportRef.current?.setPointerCapture(event.pointerId);
    setHistory(h => [...h.slice(-39), docRef.current]);
    setFuture([]);
  };

  const startTrackPosition = (event: ReactPointerEvent, item: PlacedItem) => {
    if (tool !== "select" || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelected([item.id]);
    const world = screenToWorld(event.clientX, event.clientY);
    gesture.current = { mode: "track-position", itemId: item.id, start: world, origin: { x: item.x, y: item.y }, itemSnapshot: { ...item } };
    viewportRef.current?.setPointerCapture(event.pointerId);
    setHistory(h => [...h.slice(-39), docRef.current]);
    setFuture([]);
  };

  const startPathMove = (event: ReactPointerEvent, path: PathItem) => {
    if (tool !== "select" || event.button !== 0) return;
    if (docRef.current.layers.find(layer => layer.id === (path.layerId ?? GAMEPLAY_LAYER_ID))?.locked) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedSide(null);
    setSelectedVertex(null);
    const world = screenToWorld(event.clientX, event.clientY);
    let dragPath = path;
    if (!event.shiftKey && selected.length === 1) {
      const selectedPathAtPoint = docRef.current.paths.find(candidate => candidate.id === selected[0] && pathTouchesPoint(candidate, world, 10 / zoom));
      if (selectedPathAtPoint) dragPath = selectedPathAtPoint;
    }
    const cycleOnClick = !event.shiftKey && selected.length === 1 && selected[0] === dragPath.id;
    setActiveLayerId(dragPath.layerId ?? GAMEPLAY_LAYER_ID);
    const activeIds = event.shiftKey
      ? Array.from(new Set([...selected, dragPath.id]))
      : selected.includes(dragPath.id) ? selected : [dragPath.id];
    setSelected(activeIds);
    const itemSnapshots = docRef.current.items.filter(candidate => activeIds.includes(candidate.id)).map(candidate => ({ ...candidate }));
    const pathSnapshots = docRef.current.paths.filter(candidate => activeIds.includes(candidate.id)).map(candidate => ({ ...candidate, from: { ...candidate.from }, to: { ...candidate.to }, control: candidate.control ? { ...candidate.control } : undefined }));
    gesture.current = { mode: "item", itemId: dragPath.id, start: world, origin: dragPath.from, itemSnapshots, pathSnapshots, cycleOnClick, clickPoint: world };
    viewportRef.current?.setPointerCapture(event.pointerId);
    setHistory(h => [...h.slice(-39), docRef.current]);
    setFuture([]);
  };

  const startPathHandle = (event: ReactPointerEvent, path: PathItem, pathHandle: "from" | "to" | "control") => {
    if (tool !== "select" || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelected([path.id]);
    const world = screenToWorld(event.clientX, event.clientY);
    gesture.current = { mode: "path-handle", start: world, origin: world, pathSnapshot: { ...path, from: { ...path.from }, to: { ...path.to }, control: path.control ? { ...path.control } : undefined }, pathHandle };
    viewportRef.current?.setPointerCapture(event.pointerId);
    setHistory(h => [...h.slice(-39), docRef.current]);
    setFuture([]);
  };

  const selectPolygonSide = (event: ReactPointerEvent, item: PlacedItem, index: number) => {
    if (tool !== "select" || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelected([item.id]);
    setSelectedSide({ itemId: item.id, index });
    setSelectedVertex(null);
  };

  const startRoomSideExtrude = (event: ReactPointerEvent, item: PlacedItem, sideIndex: number) => {
    if (tool !== "select" || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setActiveLayerId(item.layerId ?? GAMEPLAY_LAYER_ID);
    setSelected([item.id]);
    setSelectedSide({ itemId: item.id, index: sideIndex });
    setSelectedVertex(null);
    const world = screenToWorld(event.clientX, event.clientY);
    gesture.current = {
      mode: "room-side-extrude",
      start: world,
      origin: { x: item.x, y: item.y },
      itemId: item.id,
      itemSnapshot: { ...item, polygonPoints: polygonPoints(item).map(point => ({ ...point })), sideTypes: item.sideTypes ? [...item.sideTypes] : undefined },
      sideIndex,
    };
    viewportRef.current?.setPointerCapture(event.pointerId);
    setHistory(history => [...history.slice(-39), docRef.current]);
    setFuture([]);
  };

  const startPolygonVertex = (event: ReactPointerEvent, item: PlacedItem, vertexIndex: number) => {
    if (tool !== "select" || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelected([item.id]);
    setSelectedSide(null);
    setSelectedVertex(item.kind === "room" ? { itemId: item.id, index: vertexIndex } : null);
    const world = screenToWorld(event.clientX, event.clientY);
    gesture.current = { mode: "polygon-vertex", start: world, origin: { x: item.x, y: item.y }, itemSnapshot: { ...item, polygonPoints: polygonPoints(item).map(point => ({ ...point })) }, vertexIndex };
    viewportRef.current?.setPointerCapture(event.pointerId);
    setHistory(h => [...h.slice(-39), docRef.current]);
    setFuture([]);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const raw = event.dataTransfer.getData("application/blockout-primitive");
    if (!raw) return;
    const template = JSON.parse(raw) as (typeof palette)[number]["items"][number];
    const world = screenToWorld(event.clientX, event.clientY);
    const item: PlacedItem = {
      id: id(), kind: template.kind, label: template.label, color: template.color, w: template.w, h: template.h, layerId: activeLayerId,
      x: snap(world.x - template.w * CELL / 2), y: snap(world.y - template.h * CELL / 2),
      ...(template.kind === "moving" ? { trackPosition: .5, trackOrientation: "horizontal" as TrackOrientation } : {}),
      ...(template.kind === "platform" ? { platformMode: "normal" as PlatformMode } : {}),
      ...(template.kind === "hazard" ? { hazardDirection: "up" as HazardDirection } : {}),
      ...(template.kind === "enemy" ? { enemyType: template.enemyType ?? "normal" } : {}),
      ...(template.kind === "npc" ? { npcRole: template.npcRole ?? "npc" } : {}),
      ...(template.kind === "key" ? { keyName: "Key_A" } : {}),
      ...(template.kind === "liquid" ? {
        polygonPoints: [{ x: 0, y: 0 }, { x: template.w * CELL, y: 0 }, { x: template.w * CELL, y: template.h * CELL }, { x: 0, y: template.h * CELL }],
        sideTypes: ["waves", "straight", "straight", "straight"] as SideType[],
      } : {}),
      ...(template.kind === "room" ? {
        polygonPoints: [{ x: 0, y: 0 }, { x: template.w * CELL, y: 0 }, { x: template.w * CELL, y: template.h * CELL }, { x: 0, y: template.h * CELL }],
        sideTypes: ["straight", "straight", "straight", "straight"] as SideType[],
      } : {}),
    };
    commit(current => ({ ...current, items: [...current.items, item] }));
    setSelected([item.id]);
  };

  const exportMap = () => {
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `${doc.name || "location"}.json`; anchor.click();
    URL.revokeObjectURL(url);
  };

  const importMap = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Partial<MapDocument>;
        if (!Array.isArray(parsed.items) || !Array.isArray(parsed.paths)) throw new Error();
        const normalized = normalizeDocument(parsed);
        commit(normalized);
        setActiveLayerId(normalized.layers.find(layer => layer.id === GAMEPLAY_LAYER_ID && layer.visible && !layer.locked)?.id ?? normalized.layers.find(layer => layer.visible && !layer.locked)?.id ?? normalized.layers[0].id);
        setSelected([]);
      } catch { window.alert("Не удалось прочитать файл карты."); }
    };
    reader.readAsText(file);
  };

  const selectedItem = useMemo(() => selected.length === 1 ? doc.items.find(item => item.id === selected[0]) : undefined, [doc.items, selected]);
  const selectedPath = useMemo(() => selected.length === 1 ? doc.paths.find(path => path.id === selected[0]) : undefined, [doc.paths, selected]);
  const layerIndex = useMemo(() => new Map(doc.layers.map((layer, index) => [layer.id, index])), [doc.layers]);
  const visibleLayerIds = useMemo(() => new Set(doc.layers.filter(layer => layer.visible).map(layer => layer.id)), [doc.layers]);
  const visibleItems = useMemo(() => doc.items
    .filter(item => visibleLayerIds.has(item.layerId ?? GAMEPLAY_LAYER_ID))
    .sort((a, b) => (layerIndex.get(a.layerId ?? GAMEPLAY_LAYER_ID) ?? 0) - (layerIndex.get(b.layerId ?? GAMEPLAY_LAYER_ID) ?? 0)), [doc.items, layerIndex, visibleLayerIds]);
  const locationKeyNames = useMemo(() => Array.from(new Set(doc.items.filter(item => item.kind === "key").map(item => item.keyName ?? "Key_A"))), [doc.items]);
  const linkedKey = useMemo(() => selectedItem?.kind === "door" && selectedItem.keyName
    ? doc.items.find(item => item.kind === "key" && (item.keyName ?? "Key_A") === selectedItem.keyName)
    : undefined, [doc.items, selectedItem]);
  const allPaths = (draftPath ? [...doc.paths, draftPath] : doc.paths)
    .filter(path => visibleLayerIds.has(path.layerId ?? GAMEPLAY_LAYER_ID))
    .sort((a, b) => (layerIndex.get(a.layerId ?? GAMEPLAY_LAYER_ID) ?? 0) - (layerIndex.get(b.layerId ?? GAMEPLAY_LAYER_ID) ?? 0));

  const addLayer = () => {
    const layer: MapLayer = { id: id(), name: `Слой ${doc.layers.length + 1}`, visible: true, locked: false };
    commit(current => ({ ...current, layers: [...current.layers, layer] }));
    setActiveLayerId(layer.id);
  };

  const updateLayer = (layerId: string, changes: Partial<MapLayer>) => {
    commit(current => ({ ...current, layers: current.layers.map(layer => layer.id === layerId ? { ...layer, ...changes } : layer) }));
    if (changes.visible === false || changes.locked === true) {
      const affectedIds = new Set([
        ...doc.items.filter(item => (item.layerId ?? GAMEPLAY_LAYER_ID) === layerId).map(item => item.id),
        ...doc.paths.filter(path => (path.layerId ?? GAMEPLAY_LAYER_ID) === layerId).map(path => path.id),
      ]);
      setSelected(current => current.filter(selectedId => !affectedIds.has(selectedId)));
      setSelectedSide(null);
    }
  };

  const renameLayer = (layerId: string, name: string) => {
    const next = { ...docRef.current, layers: docRef.current.layers.map(layer => layer.id === layerId ? { ...layer, name } : layer) };
    docRef.current = next;
    setDoc(next);
    setSaved(false);
  };

  const moveLayer = (layerId: string, delta: number) => commit(current => {
    const index = current.layers.findIndex(layer => layer.id === layerId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= current.layers.length) return current;
    const layers = [...current.layers];
    [layers[index], layers[target]] = [layers[target], layers[index]];
    return { ...current, layers };
  });

  const removeLayer = (layerId: string) => {
    if (doc.layers.length <= 1) return;
    const fallback = doc.layers.find(layer => layer.id !== layerId)!;
    commit(current => ({
      ...current,
      layers: current.layers.filter(layer => layer.id !== layerId),
      items: current.items.map(item => (item.layerId ?? GAMEPLAY_LAYER_ID) === layerId ? { ...item, layerId: fallback.id } : item),
      paths: current.paths.map(path => (path.layerId ?? GAMEPLAY_LAYER_ID) === layerId ? { ...path, layerId: fallback.id } : path),
    }));
    setActiveLayerId(fallback.id);
    setSelected([]);
    setSelectedSide(null);
  };

  const moveSelectionToLayer = (layerId: string) => {
    const selectedIds = new Set(selected);
    commit(current => ({
      ...current,
      items: current.items.map(item => selectedIds.has(item.id) ? { ...item, layerId } : item),
      paths: current.paths.map(path => selectedIds.has(path.id) ? { ...path, layerId } : path),
    }));
  };

  const setSelectedPolygonSideType = (type: SideType) => {
    if (!selectedItem || (selectedItem.kind !== "liquid" && selectedItem.kind !== "room") || !selectedSide || selectedSide.itemId !== selectedItem.id) return;
    commit(current => ({ ...current, items: current.items.map(item => {
      if (item.id !== selectedItem.id) return item;
      const points = polygonPoints(item);
      const sideTypes = Array.from({ length: points.length }, (_, index) => item.sideTypes?.[index] ?? "straight") as SideType[];
      sideTypes[selectedSide.index] = type;
      return { ...item, polygonPoints: points, sideTypes };
    }) }));
  };

  const addPointToSelectedSide = () => {
    if (!selectedItem || (selectedItem.kind !== "liquid" && selectedItem.kind !== "room") || !selectedSide || selectedSide.itemId !== selectedItem.id) return;
    const sideIndex = selectedSide.index;
    commit(current => ({ ...current, items: current.items.map(item => {
      if (item.id !== selectedItem.id) return item;
      const points = polygonPoints(item).map(point => ({ ...point }));
      const nextIndex = (sideIndex + 1) % points.length;
      const midpoint = { x: (points[sideIndex].x + points[nextIndex].x) / 2, y: (points[sideIndex].y + points[nextIndex].y) / 2 };
      points.splice(sideIndex + 1, 0, midpoint);
      const sideTypes = Array.from({ length: points.length - 1 }, (_, index) => item.sideTypes?.[index] ?? "straight") as SideType[];
      const currentType = sideTypes[sideIndex] ?? "straight";
      sideTypes.splice(sideIndex, 1, currentType, currentType);
      return { ...item, polygonPoints: points, sideTypes };
    }) }));
  };

  return (
    <main className="app-shell" style={{ "--inactive-layer-opacity": doc.inactiveLayerOpacity ?? .32 } as React.CSSProperties} onContextMenu={event => event.preventDefault()}>
      <header className="topbar">
        <div className="brand"><span className="brand-mark">B</span><span>BLOCKOUT</span><span className="version">LOCAL</span></div>
        <input className="map-name" value={doc.name} aria-label="Название локации" onChange={event => { setDoc({ ...doc, name: event.target.value }); setSaved(false); }} />
        <div className="top-actions">
          <span className={`save-state ${saved ? "is-saved" : ""}`}>{saved ? "● Сохранено" : "● Сохранение…"}</span>
          <button onClick={undo} disabled={!history.length} title="Отменить (Ctrl+Z)">↶</button>
          <button onClick={redo} disabled={!future.length} title="Повторить (Ctrl+Y)">↷</button>
          <button onClick={() => fileRef.current?.click()}>Импорт</button>
          <button className="accent-button" onClick={exportMap}>Экспорт JSON</button>
          <input ref={fileRef} hidden type="file" accept=".json,application/json" onChange={event => event.target.files?.[0] && importMap(event.target.files[0])} />
        </div>
      </header>

      <aside className="palette">
        <div className="panel-heading"><span>ПАЛЕТКА</span><span className="panel-count">{palette.reduce((sum, group) => sum + group.items.length, 0)}</span></div>
        <div className="palette-scroll">
          {palette.map(group => <section className="palette-group" key={group.title}>
            <button className="palette-group-header" aria-expanded={!collapsedGroups.includes(group.title)} onClick={() => setCollapsedGroups(current => current.includes(group.title) ? current.filter(title => title !== group.title) : [...current, group.title])}>
              <span className="group-chevron" aria-hidden="true">{collapsedGroups.includes(group.title) ? "+" : "−"}</span>
              <span>{group.title}</span><small>{group.items.length}</small>
            </button>
            {!collapsedGroups.includes(group.title) && <div className="palette-group-items">{group.items.map(item => <div className="palette-item" draggable key={`${group.title}-${item.label}`} onDragStart={event => {
              event.dataTransfer.setData("application/blockout-primitive", JSON.stringify(item));
              event.dataTransfer.effectAllowed = "copy";
            }}>
              <span className="palette-icon" style={{ color: item.color, borderColor: `${item.color}55` }}>{item.icon}</span>
              <span><b>{item.label}</b><small>{item.w} × {item.h} клетки</small></span>
              <span className="drag-handle">⠿</span>
            </div>)}</div>}
          </section>)}
        </div>
        <div className="palette-help"><b>Подсказка</b><span>Тяните пустое поле, чтобы двигать карту. Тяните объект, чтобы переместить его.</span></div>
      </aside>

      <section className="workspace">
        <div className="toolstrip">
          <button className={tool === "select" ? "active" : ""} onClick={() => setTool("select")}><span>✥</span> Правка <kbd>1</kbd></button>
          <i />
          <button className={tool === "line" ? "active" : ""} onClick={() => setTool("line")}><span>╱</span> Линия <kbd>2</kbd></button>
          <button className={tool === "arrow" ? "active" : ""} onClick={() => setTool("arrow")}><span>➜</span> Стрелка <kbd>3</kbd></button>
          <i />
          <button className="danger-tool" disabled={!selected.length} onClick={removeSelected}>Удалить{selected.length > 1 ? ` (${selected.length})` : ""}</button>
          <span className="active-layer-chip">Слой: {doc.layers.find(layer => layer.id === activeLayerId)?.name ?? "—"}</span>
        </div>
        <div
          ref={viewportRef}
          className={`viewport tool-${tool}`}
          style={{ backgroundSize: `${CELL * zoom}px ${CELL * zoom}px`, backgroundPosition: `${pan.x}px ${pan.y}px` }}
          onWheel={onWheel}
          onPointerDown={onViewportDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDragOver={event => event.preventDefault()}
          onDrop={onDrop}
        >
          <div className="world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
            <svg className="path-layer" aria-hidden="true">
              <defs><marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="context-stroke" /></marker></defs>
              {allPaths.map(path => {
                const pathLayer = doc.layers.find(layer => layer.id === (path.layerId ?? GAMEPLAY_LAYER_ID));
                return <g key={path.id} className={`${selected.includes(path.id) ? "selected-path" : ""} ${pathLayer?.locked ? "locked-layer-object" : ""} ${path.id !== draftPath?.id && (path.layerId ?? GAMEPLAY_LAYER_ID) !== activeLayerId ? "inactive-layer-object" : ""}`}>
                {path.pathMode === "rail" && <path className="rail-bed" d={pathData(path)} stroke={path.color} />}
                <path className={`map-path ${path.pathMode === "rail" ? "rail-center" : ""}`} d={pathData(path)} stroke={path.pathMode === "rail" ? "#121820" : path.color} markerEnd={path.kind === "arrow" && path.pathMode !== "rail" ? "url(#arrowhead)" : undefined} />
                {path.pathMode === "rail" && railArrows(path).map((arrow, index) => <path
                  className="rail-direction-arrow" key={`rail-arrow-${index}`} d="M -6 -4 L 6 0 L -6 4 Z"
                  transform={`translate(${arrow.x} ${arrow.y}) rotate(${arrow.angle})`} fill="#f5f8fa"
                />)}
                <path className="path-hit" d={pathData(path)} onPointerDown={event => startPathMove(event, path)} />
              </g>;})}
              {selectedPath && <>
                <path className="control-guide" d={`M ${selectedPath.from.x} ${selectedPath.from.y} L ${pathControl(selectedPath).x} ${pathControl(selectedPath).y} L ${selectedPath.to.x} ${selectedPath.to.y}`} />
                <circle className="path-node endpoint-node" cx={selectedPath.from.x} cy={selectedPath.from.y} r="6" onPointerDown={event => startPathHandle(event, selectedPath, "from")} />
                <circle className="path-node control-node" cx={pathControl(selectedPath).x} cy={pathControl(selectedPath).y} r="7" onPointerDown={event => startPathHandle(event, selectedPath, "control")} />
                <circle className="path-node endpoint-node" cx={selectedPath.to.x} cy={selectedPath.to.y} r="6" onPointerDown={event => startPathHandle(event, selectedPath, "to")} />
              </>}
              {selectedItem?.kind === "door" && linkedKey && <line
                className="key-link-line"
                x1={selectedItem.x + selectedItem.w * CELL / 2}
                y1={selectedItem.y + selectedItem.h * CELL / 2}
                x2={linkedKey.x + linkedKey.w * CELL / 2}
                y2={linkedKey.y + linkedKey.h * CELL / 2}
                stroke={itemColor(selectedItem, doc.items)}
              />}
            </svg>
            {visibleItems.map(item => {
              const itemLayer = doc.layers.find(layer => layer.id === (item.layerId ?? GAMEPLAY_LAYER_ID));
              return <div
              key={item.id}
              className={`map-item kind-${item.kind} ${item.kind === "platform" ? `platform-${item.platformMode ?? "normal"}` : ""} ${item.kind === "moving" ? `moving-${item.trackOrientation ?? "horizontal"}` : ""} ${itemLayer?.locked ? "locked-layer-object" : ""} ${(item.layerId ?? GAMEPLAY_LAYER_ID) !== activeLayerId ? "inactive-layer-object" : ""} ${selected.includes(item.id) ? "selected" : ""}`}
              style={{ left: item.x, top: item.y, width: item.w * CELL, height: item.h * CELL, zIndex: selected.includes(item.id) ? 1000 : 10 + (layerIndex.get(item.layerId ?? GAMEPLAY_LAYER_ID) ?? 0) * 10, "--item-color": itemColor(item, doc.items), "--cells": item.w } as React.CSSProperties}
              onPointerDown={event => startItemDrag(event, item)}
            >
              {item.kind === "room" ? <svg className="room-shape" viewBox={`0 0 ${item.w * CELL} ${item.h * CELL}`} preserveAspectRatio="none">
                <polygon className="room-fill" points={polygonPoints(item).map(point => `${point.x},${point.y}`).join(" ")} />
                {polygonPoints(item).map((point, index, points) => {
                  const next = points[(index + 1) % points.length];
                  const sideType = item.sideTypes?.[index] ?? "straight";
                  const isSelectedSide = selectedSide?.itemId === item.id && selectedSide.index === index;
                  return <g key={`room-side-${index}`} className={isSelectedSide ? "room-side-selected" : ""}>
                    <path className={`room-side room-side-${sideType}`} pathLength="100" d={sidePathData(point, next, "straight")} />
                    <path className="room-side-hit" d={sidePathData(point, next, "straight")} onPointerDown={event => startRoomSideExtrude(event, item, index)} />
                    {(sideType === "door" || sideType === "opening") && <text className={`room-side-label room-side-label-${sideType}`} x={(point.x + next.x) / 2} y={(point.y + next.y) / 2}>{sideType === "door" ? "ДВЕРЬ" : "ПРОХОД"}</text>}
                  </g>;
                })}
                {selected.length === 1 && selected[0] === item.id && polygonPoints(item).map((point, index) => <circle
                  className={`room-vertex ${selectedVertex?.itemId === item.id && selectedVertex.index === index ? "room-vertex-selected" : ""}`} key={`room-vertex-${index}`} cx={point.x} cy={point.y} r={selectedVertex?.itemId === item.id && selectedVertex.index === index ? "8" : "6"}
                  onPointerDown={event => startPolygonVertex(event, item, index)}
                />)}
              </svg> : item.kind === "liquid" ? <svg className="liquid-shape" viewBox={`0 0 ${item.w * CELL} ${item.h * CELL}`} preserveAspectRatio="none">
                <polygon className="liquid-fill" points={polygonPoints(item).map(point => `${point.x},${point.y}`).join(" ")} />
                {polygonPoints(item).map((point, index, points) => {
                  const next = points[(index + 1) % points.length];
                  const sideType = item.sideTypes?.[index] ?? "straight";
                  const isSelectedSide = selectedSide?.itemId === item.id && selectedSide.index === index;
                  return <g key={`side-${index}`} className={isSelectedSide ? "liquid-side-selected" : ""}>
                    <path className={`liquid-side liquid-side-${sideType}`} d={sidePathData(point, next, sideType)} />
                    <path className="liquid-side-hit" d={sidePathData(point, next, sideType)} onPointerDown={event => selectPolygonSide(event, item, index)} />
                  </g>;
                })}
                {selected.length === 1 && selected[0] === item.id && polygonPoints(item).map((point, index) => <circle
                  className="liquid-vertex" key={`vertex-${index}`} cx={point.x} cy={point.y} r="6"
                  onPointerDown={event => startPolygonVertex(event, item, index)}
                />)}
              </svg> : item.kind === "enemy" ? <div className={`enemy-grid enemy-${item.enemyType ?? (item.color.toLowerCase() === "#d84c60" ? "heavy" : "normal")}`}>
                {Array.from({ length: item.w * item.h }, (_, index) => <span className="enemy-cell" key={index}>
                  {(item.enemyType ?? (item.color.toLowerCase() === "#d84c60" ? "heavy" : "normal")) === "heavy"
                    ? <span className="enemy-shield"><span className="enemy-diamond" /></span>
                    : <span className="enemy-diamond" />}
                </span>)}
              </div> : item.kind === "player" || item.kind === "npc" ? <div className={`character-placeholder ${item.kind === "player" ? "character-player" : `character-${item.npcRole ?? "npc"}`} ${item.w <= 1 && item.h <= 1 ? "character-compact" : ""}`}>
                <span className="character-caption">{item.kind === "player" ? "ИГРОК" : item.npcRole === "merchant" ? "ТОРГОВЕЦ" : "NPC"}</span>
                <span className="character-head" />
                <span className="character-body" />
                <span className="character-arm character-arm-left" /><span className="character-arm character-arm-right" />
                <span className="character-leg character-leg-left" /><span className="character-leg character-leg-right" />
                {item.kind === "npc" && item.npcRole === "merchant" && <span className="merchant-bag">¤</span>}
              </div> : item.kind === "ladder" ? <div className="ladder-shape">
                <span className="ladder-rail ladder-rail-left" /><span className="ladder-rail ladder-rail-right" />
                {Array.from({ length: Math.max(2, item.h * 2) }, (_, index) => <span className="ladder-rung" style={{ top: `${(index + 1) * 100 / (item.h * 2 + 1)}%` }} key={index} />)}
                <span className="climb-label">{item.label}</span>
              </div> : item.kind === "vine" ? <div className="vine-shape">
                {Array.from({ length: item.w }, (_, column) => <span className="vine-strand" style={{ left: column * CELL }} key={column}>
                  <span className="vine-stem" />
                  {Array.from({ length: Math.max(2, item.h) }, (_, index) => <span className={`vine-leaf ${index % 2 === 0 ? "leaf-left" : "leaf-right"}`} style={{ top: `${(index + .65) * 100 / item.h}%` }} key={index} />)}
                </span>)}
                <span className="climb-label">{item.label}</span>
              </div> : item.kind === "hazard" ? <div className={`hazard-spikes hazard-${item.hazardDirection ?? "up"}`} aria-label={`${item.w * item.h} клеток опасности`}>
                {Array.from({ length: item.w * item.h }, (_, index) => <span className="hazard-spike" key={index} />)}
              </div> : item.kind === "moving" ? <>
                <span className="moving-track-line" />
                <button
                  className="moving-platform-marker"
                  style={item.trackOrientation === "vertical"
                    ? { left: "50%", top: `${(item.trackPosition ?? .5) * 100}%` }
                    : { left: `${(item.trackPosition ?? .5) * 100}%`, top: "50%" }}
                  aria-label="Положение платформы на треке"
                  title="Перетащите платформу вдоль трека"
                  onPointerDown={event => startTrackPosition(event, item)}
                />
                <span className="moving-label">{item.label}</span>
              </> : item.kind === "key" ? <div className="key-token">
                <span className="key-head">K</span><span className="key-name">{item.keyName ?? "Key_A"}</span>
              </div> : item.kind === "door" ? <div className="key-door">
                <span className="door-bars" /><span className="key-name">{item.keyName || "ОБЫЧНАЯ"}</span>
              </div> : item.kind === "secret" ? <div className="secret-zone">
                <span>СЕКРЕТНАЯ ЗОНА</span><small>скрытый проход</small>
              </div> : item.kind === "checkpoint" ? <div className="checkpoint-bench">
                <span className="bench-back" /><span className="bench-seat" /><span className="bench-leg bench-leg-left" /><span className="bench-leg bench-leg-right" />
                <small>CHECKPOINT</small>
              </div> : item.kind === "comment" ? <div className="comment-zone">
                <span>{item.label || "Комментарий зоны"}</span>
              </div> : item.kind === "boss" ? <div className={`boss-figure ${item.w < 2 || item.h < 2 ? "boss-compact" : ""}`}>
                <span className="boss-name">{item.label || "ИМЯ БОССА"}</span>
                <span className="boss-head" />
                <span className="boss-arm boss-arm-left" /><span className="boss-arm boss-arm-right" />
                <span className="boss-body">БОСС</span>
                <span className="boss-leg boss-leg-left" /><span className="boss-leg boss-leg-right" />
              </div> : <>
                <span className="item-symbol">{palette.flatMap(group => group.items).find(template => template.kind === item.kind)?.icon}</span>
                <span className="item-label">{item.label}</span>
              </>}
              {item.kind === "platform" && item.platformMode === "crumble" && <span className="platform-mode-badge">ОСЫПАЕТСЯ</span>}
              {item.kind === "platform" && item.platformMode === "damage" && <span className="platform-mode-badge">УРОН</span>}
              <span className="item-size">{item.w}×{item.h}</span>
              {selected.length === 1 && selected[0] === item.id && (item.kind === "enemy" || item.kind === "platform" || item.kind === "door" || item.kind === "secret" || item.kind === "comment") && <>
                <button className="resize-handle resize-n" aria-label="Растянуть вверх" title="Растянуть вверх" onPointerDown={event => startResize(event, item, "n")} />
                <button className="resize-handle resize-e" aria-label="Растянуть вправо" title="Растянуть вправо" onPointerDown={event => startResize(event, item, "e")} />
                <button className="resize-handle resize-s" aria-label="Растянуть вниз" title="Растянуть вниз" onPointerDown={event => startResize(event, item, "s")} />
                <button className="resize-handle resize-w" aria-label="Растянуть влево" title="Растянуть влево" onPointerDown={event => startResize(event, item, "w")} />
              </>}
              {selected.length === 1 && selected[0] === item.id && (item.kind === "moving" || item.kind === "hazard") && <>
                {(item.kind !== "moving" || item.trackOrientation !== "vertical") && <>
                  <button className="resize-handle resize-e" aria-label="Добавить справа" title="Растянуть вправо" onPointerDown={event => startResize(event, item, "e")} />
                  <button className="resize-handle resize-w" aria-label="Добавить слева" title="Растянуть влево" onPointerDown={event => startResize(event, item, "w")} />
                </>}
                {item.kind === "moving" && item.trackOrientation === "vertical" && <>
                  <button className="resize-handle resize-n" aria-label="Растянуть вверх" title="Растянуть вверх" onPointerDown={event => startResize(event, item, "n")} />
                  <button className="resize-handle resize-s" aria-label="Растянуть вниз" title="Растянуть вниз" onPointerDown={event => startResize(event, item, "s")} />
                </>}
                {item.kind === "hazard" && <>
                  <button className="resize-handle resize-n" aria-label="Растянуть вверх" title="Растянуть вверх" onPointerDown={event => startResize(event, item, "n")} />
                  <button className="resize-handle resize-s" aria-label="Растянуть вниз" title="Растянуть вниз" onPointerDown={event => startResize(event, item, "s")} />
                </>}
              </>}
              {selected.length === 1 && selected[0] === item.id && (item.kind === "ladder" || item.kind === "vine") && <>
                <button className="resize-handle resize-n" aria-label="Растянуть вверх" title="Растянуть вверх" onPointerDown={event => startResize(event, item, "n")} />
                <button className="resize-handle resize-s" aria-label="Растянуть вниз" title="Растянуть вниз" onPointerDown={event => startResize(event, item, "s")} />
                {item.kind === "vine" && <>
                  <button className="resize-handle resize-e" aria-label="Добавить лиану справа" title="Добавить лиану справа" onPointerDown={event => startResize(event, item, "e")} />
                  <button className="resize-handle resize-w" aria-label="Добавить лиану слева" title="Добавить лиану слева" onPointerDown={event => startResize(event, item, "w")} />
                </>}
              </>}
            </div>;})}
          </div>
          {marquee && <div className="selection-marquee" style={{
            left: Math.min(marquee.from.x, marquee.to.x) * zoom + pan.x,
            top: Math.min(marquee.from.y, marquee.to.y) * zoom + pan.y,
            width: Math.abs(marquee.to.x - marquee.from.x) * zoom,
            height: Math.abs(marquee.to.y - marquee.from.y) * zoom,
          }} />}
          {!doc.items.length && !doc.paths.length && <div className="empty-hint"><span>＋</span><b>Начните собирать локацию</b><small>Перетащите примитив из палетки слева</small></div>}
          <div className="coordinates">X {Math.round(-pan.x / zoom)} · Y {Math.round(-pan.y / zoom)}</div>
          <div className="zoom-control"><button onClick={() => setZoom(value => Math.max(.25, value - .1))}>−</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom(value => Math.min(2.5, value + .1))}>＋</button><button onClick={() => { setPan({ x: 480, y: 300 }); setZoom(1); }}>Центр</button></div>
        </div>
      </section>

      <aside className="inspector">
        <div className="panel-heading">ИНСПЕКТОР</div>
        {selected.length > 1 ? <div className="inspector-empty multi-selection"><span>{selected.length}</span><b>Объектов выбрано</b><small>Перетащите любой выбранный объект, чтобы сдвинуть всю группу. Нажмите Delete, чтобы удалить её.</small></div> : selectedItem ? <div className="inspector-body">
          <span className="selection-badge" style={{ color: itemColor(selectedItem, doc.items) }}>● ВЫБРАН ОБЪЕКТ</span>
          <label>{selectedItem.kind === "boss" ? "Имя босса" : "Название"}<input value={selectedItem.label} onChange={event => setDoc(value => ({ ...value, items: value.items.map(item => item.id === selectedItem.id ? { ...item, label: event.target.value } : item) }))} /></label>
          <label>Слой<select value={selectedItem.layerId ?? GAMEPLAY_LAYER_ID} onChange={event => moveSelectionToLayer(event.target.value)}>
            {doc.layers.filter(layer => layer.visible && !layer.locked).map(layer => <option value={layer.id} key={layer.id}>{layer.name}</option>)}
          </select></label>
          {selectedItem.kind === "platform" && <label>Режим платформы<select value={selectedItem.platformMode ?? "normal"} onChange={event => updateItemLive(selectedItem.id, { platformMode: event.target.value as PlatformMode })}>
            <option value="normal">Обычная</option>
            <option value="crumble">Осыпающаяся при наступании</option>
            <option value="damage">Наносящая урон</option>
          </select></label>}
          {selectedItem.kind === "hazard" && <label>Направление шипов<select value={selectedItem.hazardDirection ?? "up"} onChange={event => updateItemLive(selectedItem.id, { hazardDirection: event.target.value as HazardDirection })}>
            <option value="up">Вверх</option>
            <option value="down">Вниз</option>
            <option value="left">Влево</option>
            <option value="right">Вправо</option>
          </select></label>}
          {selectedItem.kind === "npc" && <label>Тип дружественного NPC<select value={selectedItem.npcRole ?? "npc"} onChange={event => updateItemLive(selectedItem.id, { npcRole: event.target.value as NpcRole })}>
            <option value="npc">Обычный NPC</option>
            <option value="merchant">Торговец</option>
          </select></label>}
          {selectedItem.kind === "key" && <>
            <label>KeyName<input value={selectedItem.keyName ?? "Key_A"} onChange={event => updateItemLive(selectedItem.id, { keyName: event.target.value || "Key_A" })} /></label>
            <div className="key-link-summary" style={{ color: itemColor(selectedItem, doc.items) }}><i />
              <span><b>{selectedItem.keyName ?? "Key_A"}</b><small>{doc.items.filter(item => item.kind === "door" && item.keyName === (selectedItem.keyName ?? "Key_A")).length} связанных дверей</small></span>
            </div>
          </>}
          {selectedItem.kind === "door" && <>
            <label>Ключ с локации<select value={selectedItem.keyName ?? ""} onChange={event => updateItemLive(selectedItem.id, { keyName: event.target.value || undefined })}>
              <option value="">Без ключа — обычная дверь</option>
              {selectedItem.keyName && !locationKeyNames.includes(selectedItem.keyName) && <option value={selectedItem.keyName} disabled>{selectedItem.keyName} — ключ не найден</option>}
              {locationKeyNames.map(keyName => <option value={keyName} key={keyName}>{keyName}</option>)}
            </select></label>
            <div className={`key-link-summary ${linkedKey ? "is-linked" : "is-unlinked"}`} style={{ color: itemColor(selectedItem, doc.items) }}><i />
              <span><b>{linkedKey ? selectedItem.keyName : "Обычная дверь"}</b><small>{linkedKey ? "Связана с ключом на карте" : locationKeyNames.length ? "Выберите ключ из списка" : "Сначала добавьте ключ на карту"}</small></span>
            </div>
          </>}
          {selectedItem.kind === "liquid" && <div className="liquid-inspector">
            <label className="color-field">Цвет жидкости<input type="color" value={selectedItem.color} onChange={event => updateItemLive(selectedItem.id, { color: event.target.value })} /></label>
            <div className="liquid-help"><b>Редактирование формы</b><small>Тяните белые вершины. Нажмите на грань, чтобы изменить только её.</small></div>
            {selectedSide?.itemId === selectedItem.id ? <>
              <span className="side-caption">СТОРОНА {selectedSide.index + 1}</span>
              <div className="side-type-buttons">
                <button className={(selectedItem.sideTypes?.[selectedSide.index] ?? "straight") === "straight" ? "active" : ""} onClick={() => setSelectedPolygonSideType("straight")}>Прямая</button>
                <button className={selectedItem.sideTypes?.[selectedSide.index] === "waves" ? "active" : ""} onClick={() => setSelectedPolygonSideType("waves")}>≈ Волны</button>
              </div>
              <button className="wide" onClick={addPointToSelectedSide}>＋ Добавить точку на сторону</button>
            </> : <div className="side-not-selected">Выберите одну из сторон многоугольника</div>}
          </div>}
          {selectedItem.kind === "room" && <div className="room-inspector">
            <div className="room-help"><b>Границы комнаты</b><small>Тяните белые вершины, чтобы менять форму. Саму сторону можно вытягивать в любом направлении — у основания останутся две новые точки.</small></div>
            {selectedVertex?.itemId === selectedItem.id ? <div className="selected-vertex-tools">
              <span>ТОЧКА {selectedVertex.index + 1}</span>
              <button disabled={polygonPoints(selectedItem).length <= 3} onClick={removeSelectedVertex}>Удалить точку</button>
              {polygonPoints(selectedItem).length <= 3 && <small>У комнаты должно остаться минимум три точки.</small>}
            </div> : selectedSide?.itemId === selectedItem.id ? <>
              <span className="side-caption">СТОРОНА {selectedSide.index + 1}</span>
              <div className="side-type-buttons room-side-buttons">
                <button className={(selectedItem.sideTypes?.[selectedSide.index] ?? "straight") === "straight" ? "active" : ""} onClick={() => setSelectedPolygonSideType("straight")}>Стена</button>
                <button className={selectedItem.sideTypes?.[selectedSide.index] === "door" ? "active" : ""} onClick={() => setSelectedPolygonSideType("door")}>Дверь</button>
                <button className={selectedItem.sideTypes?.[selectedSide.index] === "opening" ? "active" : ""} onClick={() => setSelectedPolygonSideType("opening")}>Проход</button>
              </div>
              <button className="wide" onClick={addPointToSelectedSide}>＋ Добавить точку на сторону</button>
            </> : <div className="side-not-selected">Выберите одну из сторон комнаты</div>}
          </div>}
          {selectedItem.kind === "moving" && <>
            <label>Ориентация трека<select value={selectedItem.trackOrientation ?? "horizontal"} onChange={event => {
              const trackOrientation = event.target.value as TrackOrientation;
              updateItemLive(selectedItem.id, { trackOrientation, w: selectedItem.h, h: selectedItem.w });
            }}>
              <option value="horizontal">Горизонтальная</option>
              <option value="vertical">Вертикальная</option>
            </select></label>
            <label className="track-position-field">Позиция платформы на треке
              <input type="range" min="0" max="100" step="1" value={Math.round((selectedItem.trackPosition ?? .5) * 100)} onChange={event => updateItemLive(selectedItem.id, { trackPosition: Number(event.target.value) / 100 })} />
              <span>{Math.round((selectedItem.trackPosition ?? .5) * 100)}%</span>
            </label>
          </>}
          <div className="field-row"><label>X, клетки<input type="number" value={selectedItem.x / CELL} onChange={event => setDoc(value => ({ ...value, items: value.items.map(item => item.id === selectedItem.id ? { ...item, x: Number(event.target.value) * CELL } : item) }))} /></label><label>Y, клетки<input type="number" value={selectedItem.y / CELL} onChange={event => setDoc(value => ({ ...value, items: value.items.map(item => item.id === selectedItem.id ? { ...item, y: Number(event.target.value) * CELL } : item) }))} /></label></div>
          {selectedItem.kind !== "liquid" && selectedItem.kind !== "room" && <div className="field-row"><label>Ширина<input type="number" min="1" value={selectedItem.w} onChange={event => setDoc(value => ({ ...value, items: value.items.map(item => item.id === selectedItem.id ? { ...item, w: Math.max(1, Number(event.target.value)) } : item) }))} /></label><label>Высота<input type="number" min="1" value={selectedItem.h} onChange={event => setDoc(value => ({ ...value, items: value.items.map(item => item.id === selectedItem.id ? { ...item, h: Math.max(1, Number(event.target.value)) } : item) }))} /></label></div>}
          <button className="wide danger-tool" onClick={removeSelected}>Удалить объект</button>
        </div> : selectedPath ? <div className="inspector-body path-inspector">
          <span className="selection-badge" style={{ color: selectedPath.color }}>● {selectedPath.kind === "arrow" ? "ВЫБРАНА СТРЕЛКА" : "ВЫБРАНА ЛИНИЯ"}</span>
          <label>Слой<select value={selectedPath.layerId ?? GAMEPLAY_LAYER_ID} onChange={event => moveSelectionToLayer(event.target.value)}>
            {doc.layers.filter(layer => layer.visible && !layer.locked).map(layer => <option value={layer.id} key={layer.id}>{layer.name}</option>)}
          </select></label>
          <label>Режим линии<select value={selectedPath.pathMode ?? "line"} onChange={event => updatePathLive(selectedPath.id, path => ({ ...path, pathMode: event.target.value as PathMode }))}>
            <option value="line">Обычная линия</option>
            <option value="rail">Рельсы / дорога</option>
          </select></label>
          <label className="color-field">Цвет линии<input type="color" value={selectedPath.color} onChange={event => updatePathLive(selectedPath.id, path => ({ ...path, color: event.target.value }))} /></label>
          <div className="path-help"><i /><span><b>Перемещение</b><small>Тяните саму линию</small></span></div>
          <div className="path-help"><i className="control-dot" /><span><b>Изгиб Безье</b><small>Тяните жёлтую контрольную точку</small></span></div>
          <div className="path-help"><i className="endpoint-dot" /><span><b>Концы</b><small>Тяните белые точки</small></span></div>
          <button className="wide danger-tool" onClick={removeSelected}>Удалить линию</button>
        </div> : <div className="inspector-empty"><span>◇</span><b>Ничего не выбрано</b><small>Выберите объект, линию или стрелку на карте, чтобы изменить его свойства.</small></div>}
        <section className="layers-panel">
          <div className="layers-heading"><span>СЛОИ</span><button onClick={addLayer} title="Добавить слой">＋</button></div>
          <label className="layer-opacity-control"><span>Неактивные слои</span><input type="range" min="5" max="80" step="1" value={Math.round((doc.inactiveLayerOpacity ?? .32) * 100)} onChange={event => {
            const next = { ...docRef.current, inactiveLayerOpacity: Number(event.target.value) / 100 };
            docRef.current = next;
            setDoc(next);
            setSaved(false);
          }} /><b>{Math.round((doc.inactiveLayerOpacity ?? .32) * 100)}%</b></label>
          <div className="layers-list">
            {[...doc.layers].reverse().map(layer => {
              const originalIndex = doc.layers.findIndex(candidate => candidate.id === layer.id);
              const objectsCount = doc.items.filter(item => (item.layerId ?? GAMEPLAY_LAYER_ID) === layer.id).length + doc.paths.filter(path => (path.layerId ?? GAMEPLAY_LAYER_ID) === layer.id).length;
              return <div className={`layer-row ${activeLayerId === layer.id ? "active" : ""} ${layer.locked ? "is-locked" : ""}`} key={layer.id} onClick={() => layer.visible && !layer.locked && setActiveLayerId(layer.id)}>
                <button className="layer-icon-button" title={layer.visible ? "Скрыть слой" : "Показать слой"} onClick={event => { event.stopPropagation(); updateLayer(layer.id, { visible: !layer.visible }); }}>{layer.visible ? "●" : "○"}</button>
                <input value={layer.name} aria-label="Название слоя" onClick={event => event.stopPropagation()} onChange={event => renameLayer(layer.id, event.target.value)} />
                <small>{objectsCount}</small>
                <button className="layer-icon-button" title={layer.locked ? "Разблокировать" : "Заблокировать"} onClick={event => { event.stopPropagation(); updateLayer(layer.id, { locked: !layer.locked }); }}>{layer.locked ? "◆" : "◇"}</button>
                <button className="layer-icon-button" disabled={originalIndex === doc.layers.length - 1} title="Поднять слой" onClick={event => { event.stopPropagation(); moveLayer(layer.id, 1); }}>↑</button>
                <button className="layer-icon-button" disabled={originalIndex === 0} title="Опустить слой" onClick={event => { event.stopPropagation(); moveLayer(layer.id, -1); }}>↓</button>
                <button className="layer-icon-button layer-delete" disabled={doc.layers.length <= 1} title="Удалить слой без удаления объектов" onClick={event => { event.stopPropagation(); removeLayer(layer.id); }}>×</button>
              </div>;
            })}
          </div>
        </section>
        <div className="map-stats"><span><b>{doc.items.length}</b> объектов</span><span><b>{doc.paths.length}</b> линий</span></div>
      </aside>
    </main>
  );
}
