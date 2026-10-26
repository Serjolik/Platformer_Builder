import { createWorld, parseWorld, type WorldData } from "./world-model";
import { parseBlockingSettings, parseItemBlocking, type BlockingSettings, type ItemBlocking } from "./blocking-model";
import { parseRoomTransitionBinding, validateRoomTransitionBindings, type RoomTransitionBinding } from "./room-transitions";

export type PrimitiveKind = "enemy" | "boss" | "player" | "npc" | "platform" | "moving" | "hazard" | "ladder" | "vine" | "room" | "spawn" | "goal" | "note" | "key" | "door" | "secret" | "checkpoint" | "loot" | "comment" | "liquid" | "transition";
export type Point = { x: number; y: number };
export type SideType = "straight" | "waves" | "door" | "opening" | "breakable";
export type PlatformMode = "normal" | "oneway" | "crumble" | "damage";
export type HazardDirection = "up" | "down" | "left" | "right";
export type PathMode = "line" | "rail";
export type EnemyType = "normal" | "heavy";
export type NpcRole = "npc" | "merchant";
export type TrackOrientation = "horizontal" | "vertical";
export type DoorBlockSide = "left" | "right" | "top" | "bottom";
export type MapLayer = { id: string; name: string; visible: boolean; locked: boolean };
export type PlacedItem = Point & { id: string; kind: PrimitiveKind; label: string; color: string; w: number; h: number; layerId?: string; attachedRoomId?: string; blocking?: ItemBlocking; transition?: RoomTransitionBinding; sideTransitions?: (RoomTransitionBinding | null)[]; noteFontSize?: number; trackPosition?: number; trackOrientation?: TrackOrientation; movingPlatformWidth?: number; movingPlatformHeight?: number; keyName?: string; doorBlockSide?: DoorBlockSide; polygonPoints?: Point[]; sideTypes?: SideType[]; platformMode?: PlatformMode; hazardDirection?: HazardDirection; enemyType?: EnemyType; npcRole?: NpcRole };
export type PathItem = { id: string; kind: "line" | "arrow"; from: Point; to: Point; control?: Point; color: string; pathMode?: PathMode; layerId?: string };
/** Design-only waypoints, in pixels relative to the owning room outline's top-left. */
export type RoomRoute = { id: string; roomId: string; name: string; kind: "main" | "optional" | "secret" | "return"; color: string; points: Point[]; visible: boolean };
export type MapDocument = { version: 2; name: string; grid: number; items: PlacedItem[]; paths: PathItem[]; routes?: RoomRoute[]; layers: MapLayer[]; inactiveLayerOpacity: number; world: WorldData; blocking?: BlockingSettings };

export const CELL = 32;
/** Track endpoints and footprint use canvas pixels; dimensions remain independent of track length. */
export function getMovingPlatformLayout(item: Pick<PlacedItem, "x" | "y" | "w" | "h" | "trackOrientation" | "trackPosition" | "movingPlatformWidth" | "movingPlatformHeight">) {
  const widthCells = item.movingPlatformWidth ?? 3;
  const heightCells = item.movingPlatformHeight ?? .5;
  const width = widthCells * CELL, height = heightCells * CELL;
  const vertical = item.trackOrientation === "vertical";
  const start = vertical ? { x: item.x + item.w * CELL / 2, y: item.y } : { x: item.x, y: item.y + item.h * CELL / 2 };
  const end = vertical ? { x: start.x, y: item.y + item.h * CELL } : { x: item.x + item.w * CELL, y: start.y };
  const position = item.trackPosition ?? .5;
  const center = { x: start.x + (end.x - start.x) * position, y: start.y + (end.y - start.y) * position };
  return { start, end, center, widthCells, heightCells,
    platformBounds: { x: center.x - width / 2, y: center.y - height / 2, width, height },
    sweptBounds: { x: start.x - width / 2, y: start.y - height / 2, width: end.x - start.x + width, height: end.y - start.y + height } };
}
export const STORAGE_KEY = "blockout-map-v2";
export const LEGACY_STORAGE_KEY = "blockout-map-v1";
export const BACKGROUND_LAYER_ID = "layer-background";
export const GAMEPLAY_LAYER_ID = "layer-gameplay";
export const defaultLayers = (): MapLayer[] => [
  { id: BACKGROUND_LAYER_ID, name: "Фон", visible: true, locked: false },
  { id: GAMEPLAY_LAYER_ID, name: "Геймплей", visible: true, locked: false },
];
export const emptyDocument = (): MapDocument => ({ version: 2, name: "Новый мир", grid: CELL, items: [], paths: [], layers: defaultLayers(), inactiveLayerOpacity: .32, world: createWorld() });

const kinds = new Set<PrimitiveKind>(["enemy", "boss", "player", "npc", "platform", "moving", "hazard", "ladder", "vine", "room", "spawn", "goal", "note", "key", "door", "secret", "checkpoint", "loot", "comment", "liquid", "transition"]);
function record(value: unknown, at: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${at}: ожидается объект.`);
  return value as Record<string, unknown>;
}
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function point(value: unknown, at: string) {
  const p = record(value, at);
  if (!finite(p.x) || !finite(p.y)) throw new Error(`${at}: координаты должны быть конечными числами.`);
}
function optionalString(value: Record<string, unknown>, key: string, at: string) {
  if (value[key] !== undefined && typeof value[key] !== "string") throw new Error(`${at}: поле ${key} должно быть строкой.`);
}
function optionalEnum(value: Record<string, unknown>, key: string, allowed: string[], at: string) {
  if (value[key] !== undefined && !allowed.includes(value[key] as string)) throw new Error(`${at}: неизвестное значение ${key}.`);
}

/** Read legacy geometry without assigning centimetres or deriving gameplay links from drawn lines. */
export function normalizeDocument(input: unknown): MapDocument {
  const document = record(input, "Проект");
  if (document.version === 3 && document.format === "mapconstructor-unreal")
    throw new Error("Это файл для импортёра Unreal, а не полный проект. Для редактирования выберите «Полный проект» в окне «Экспорт» и откройте сохранённый JSON проекта.");
  if (document.version !== 1 && document.version !== 2) throw new Error(`Версия проекта ${String(document.version)} не поддерживается. Нужен JSON версии 1 или 2.`);
  if (typeof document.name !== "string") throw new Error("У проекта отсутствует название.");
  if (document.grid !== undefined && document.grid !== CELL) throw new Error("Этот проект использует неподдерживаемый размер сетки. Ожидается 32.");
  if (!Array.isArray(document.items) || !Array.isArray(document.paths)) throw new Error("В проекте отсутствуют массивы объектов и линий.");
  const layers = document.layers === undefined ? defaultLayers() : document.layers;
  if (!Array.isArray(layers) || !layers.length) throw new Error("Проект должен содержать хотя бы один слой.");
  const layerIds = new Set<string>();
  for (const raw of layers) {
    const layer = record(raw, "Слой");
    if (typeof layer.id !== "string" || !layer.id || layerIds.has(layer.id) || typeof layer.name !== "string" || typeof layer.visible !== "boolean" || typeof layer.locked !== "boolean") throw new Error("Некорректный слой или повторяющийся ID слоя.");
    layerIds.add(layer.id);
  }
  const fallbackLayerId = layerIds.has(GAMEPLAY_LAYER_ID) ? GAMEPLAY_LAYER_ID : (layers[layers.length - 1] as MapLayer).id;
  const objectIds = new Set<string>();
  const checkIdentity = (value: Record<string, unknown>, at: string) => {
    if (typeof value.id !== "string" || !value.id || objectIds.has(value.id)) throw new Error(`${at}: отсутствующий или повторяющийся ID.`);
    objectIds.add(value.id);
    if (value.layerId !== undefined && (typeof value.layerId !== "string" || !layerIds.has(value.layerId))) throw new Error(`${at}: не найден указанный слой.`);
  };
  for (const raw of document.items) {
    const item = record(raw, "Объект");
    const at = `Объект «${String(item.label ?? item.id ?? "без имени")}»`;
    checkIdentity(item, at);
    point(item, at);
    if (!kinds.has(item.kind as PrimitiveKind) || typeof item.label !== "string" || typeof item.color !== "string" || !finite(item.w) || !finite(item.h) || item.w <= 0 || item.h <= 0) throw new Error(`${at}: некорректный тип, подпись или размеры.`);
    for (const key of ["attachedRoomId", "keyName"]) optionalString(item, key, at);
    if (item.blocking !== undefined) parseItemBlocking(item.blocking, `${at}.blocking`);
    if (item.transition !== undefined) parseRoomTransitionBinding(item.transition, `${at}.transition`);
    if (item.sideTransitions !== undefined) {
      if (!Array.isArray(item.sideTransitions)) throw new Error(`${at}: привязки сторон должны быть массивом.`);
      item.sideTransitions.forEach((binding, index) => { if (binding !== null) parseRoomTransitionBinding(binding, `${at}.sideTransitions[${index}]`); });
    }
    for (const key of ["noteFontSize", "trackPosition"]) if (item[key] !== undefined && !finite(item[key])) throw new Error(`${at}: некорректное числовое поле ${key}.`);
    if (item.trackPosition !== undefined && ((item.trackPosition as number) < 0 || (item.trackPosition as number) > 1)) throw new Error(`${at}: trackPosition должен быть от 0 до 1.`);
    for (const key of ["movingPlatformWidth", "movingPlatformHeight"]) {
      const value = item[key];
      if (value !== undefined && (!finite(value) || value <= 0 || value > 1024)) throw new Error(`${at}: ${key} должен быть положительным числом не больше 1024 клеток.`);
    }
    optionalEnum(item, "trackOrientation", ["horizontal", "vertical"], at);
    optionalEnum(item, "doorBlockSide", ["left", "right", "top", "bottom"], at);
    optionalEnum(item, "platformMode", ["normal", "oneway", "crumble", "damage"], at);
    optionalEnum(item, "hazardDirection", ["up", "down", "left", "right"], at);
    optionalEnum(item, "enemyType", ["normal", "heavy"], at);
    optionalEnum(item, "npcRole", ["npc", "merchant"], at);
    if (item.polygonPoints !== undefined) {
      if (!Array.isArray(item.polygonPoints) || item.polygonPoints.length < 3) throw new Error(`${at}: контур должен содержать минимум три вершины.`);
      item.polygonPoints.forEach(p => point(p, at));
    }
    if (item.sideTypes !== undefined && (!Array.isArray(item.sideTypes) || item.sideTypes.some(type => !["straight", "waves", "door", "opening", "breakable"].includes(type)))) throw new Error(`${at}: неизвестный тип стороны.`);
  }
  for (const raw of document.paths) {
    const path = record(raw, "Линия");
    checkIdentity(path, "Линия");
    if (!["line", "arrow"].includes(path.kind as string) || typeof path.color !== "string") throw new Error("Некорректный тип или цвет линии.");
    point(path.from, "Начало линии"); point(path.to, "Конец линии");
    if (path.control !== undefined) point(path.control, "Изгиб линии");
    optionalEnum(path, "pathMode", ["line", "rail"], "Линия");
  }
  if (document.inactiveLayerOpacity !== undefined && (!finite(document.inactiveLayerOpacity) || document.inactiveLayerOpacity < .05 || document.inactiveLayerOpacity > 1)) throw new Error("Некорректная прозрачность неактивных слоёв.");
  const items = document.items as PlacedItem[];
  const world = document.version === 2 ? parseWorld(document.world) : createWorld(items.filter(item => item.kind === "room"));
  if (document.routes !== undefined) {
    if (!Array.isArray(document.routes)) throw new Error("Маршруты должны быть массивом.");
    for (const raw of document.routes) {
      const route = record(raw, "Маршрут");
      checkIdentity(route, "Маршрут");
      if (typeof route.roomId !== "string" || !world.rooms.some(room => room.id === route.roomId)) throw new Error("Маршрут привязан к отсутствующей комнате.");
      if (typeof route.name !== "string" || !route.name.trim() || route.name.length > 120 || typeof route.color !== "string" || !/^#[\da-f]{6}$/i.test(route.color) || typeof route.visible !== "boolean") throw new Error("Некорректное имя, цвет или видимость маршрута.");
      if (!["main", "optional", "secret", "return"].includes(route.kind as string)) throw new Error("Неизвестное назначение маршрута.");
      if (!Array.isArray(route.points) || route.points.length < 2 || route.points.length > 2048) throw new Error("Маршрут должен содержать от 2 до 2048 точек.");
      route.points.forEach(p => point(p, "Точка маршрута"));
    }
  }
  const shapeIds = new Set(items.filter(item => item.kind === "room").map(item => item.id));
  for (const item of items) if (item.attachedRoomId && !shapeIds.has(item.attachedRoomId)) throw new Error(`Объект «${item.label}» привязан к отсутствующему контуру комнаты.`);
  const normalized: MapDocument = {
    version: 2,
    name: document.name,
    grid: CELL,
    layers: structuredClone(layers as MapLayer[]),
    inactiveLayerOpacity: document.inactiveLayerOpacity as number | undefined ?? .32,
    items: items.map(item => ({ ...structuredClone(item), layerId: item.layerId ?? fallbackLayerId })),
    paths: (document.paths as PathItem[]).map(path => ({ ...structuredClone(path), layerId: path.layerId ?? fallbackLayerId })),
    world,
    ...(document.routes === undefined ? {} : { routes: structuredClone(document.routes as RoomRoute[]) }),
    ...(document.blocking === undefined ? {} : { blocking: parseBlockingSettings(document.blocking) }),
  };
  validateRoomTransitionBindings(normalized);
  return normalized;
}
