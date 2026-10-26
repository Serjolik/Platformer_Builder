import { CELL, emptyDocument, getMovingPlatformLayout, normalizeDocument, type MapDocument, type PlacedItem, type Point } from "./map-document";
import { defaultItemBlockingMode, type BlockingMode } from "./blocking-model";

export const TEMPLATE_STORAGE_KEY = "mapconstructor-object-library-v1";
export type TemplateItem = Omit<PlacedItem, "id" | "layerId" | "attachedRoomId" | "blocking" | "transition" | "sideTransitions"> & { blockingMode?: BlockingMode };
export type ObjectTemplate = { id: string; name: string; items: TemplateItem[]; width: number; height: number };
export type TemplateLibraryDocument = { format: "mapconstructor-object-library"; version: 1; templates: ObjectTemplate[] };
const transferableFields = ["kind", "label", "color", "x", "y", "w", "h", "noteFontSize", "trackPosition", "trackOrientation", "movingPlatformWidth", "movingPlatformHeight", "keyName", "doorBlockSide", "polygonPoints", "sideTypes", "platformMode", "hazardDirection", "enemyType", "npcRole"] as const;
const MAX_TEMPLATES = 200, MAX_ITEMS = 1000;

export function templateSelection(document: MapDocument, selectedIds: string[]): PlacedItem[] {
  const ids = new Set(selectedIds);
  return document.items.filter(item => ids.has(item.id) && item.kind !== "room" && item.kind !== "transition");
}

function cleanItem(item: PlacedItem): TemplateItem {
  const result = Object.fromEntries(transferableFields.filter(field => item[field] !== undefined).map(field => [field, structuredClone(item[field])])) as TemplateItem;
  if (item.blocking) result.blockingMode = item.blocking.mode;
  return result;
}

function bounds(items: TemplateItem[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const include = (point: Point) => { minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y); };
  for (const item of items) {
    include({ x: item.x, y: item.y }); include({ x: item.x + item.w * CELL, y: item.y + item.h * CELL });
    for (const point of item.polygonPoints ?? []) include({ x: item.x + point.x, y: item.y + point.y });
    if (item.kind === "moving") {
      const swept = getMovingPlatformLayout(item).sweptBounds;
      include({ x: swept.x, y: swept.y }); include({ x: swept.x + swept.width, y: swept.y + swept.height });
    }
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function templateName(name: unknown): string {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 80) throw new Error("Название заготовки должно содержать от 1 до 80 символов.");
  return name.trim();
}

export function createTemplate(document: MapDocument, selectedIds: string[], name: string): ObjectTemplate {
  const items = templateSelection(document, selectedIds).map(cleanItem);
  if (!items.length) throw new Error("Выделите объекты для заготовки. Контуры комнат, переходы и маршруты в неё не входят.");
  if (items.length > MAX_ITEMS) throw new Error(`В одной заготовке может быть не больше ${MAX_ITEMS} объектов.`);
  const box = bounds(items);
  return { id: crypto.randomUUID(), name: templateName(name), width: box.width, height: box.height,
    items: items.map(item => ({ ...item, x: item.x - box.x, y: item.y - box.y })) };
}

export function instantiateTemplate(template: ObjectTemplate, target: { position: Point; layerId: string; roomId?: string | null; shapeItemId?: string }): PlacedItem[] {
  return template.items.map(source => {
    const { blockingMode, ...geometry } = structuredClone(source);
    return { ...geometry, id: crypto.randomUUID(), x: geometry.x + target.position.x, y: geometry.y + target.position.y,
      layerId: target.layerId,
      ...(target.shapeItemId ? { attachedRoomId: target.shapeItemId } : {}),
      blocking: { roomId: target.roomId ?? null, mode: blockingMode ?? defaultItemBlockingMode(source.kind, source.platformMode) } };
  });
}

export function serializeTemplateLibrary(templates: ObjectTemplate[]): TemplateLibraryDocument {
  return { format: "mapconstructor-object-library", version: 1, templates: structuredClone(templates) };
}

/** Read external files through the same geometry validation as projects, then whitelist portable fields. */
export function parseTemplateLibrary(input: unknown): ObjectTemplate[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Ожидается файл библиотеки заготовок.");
  const data = input as Record<string, unknown>;
  if (data.format !== "mapconstructor-object-library" || data.version !== 1 || !Array.isArray(data.templates)) throw new Error("Нужен файл библиотеки заготовок версии 1.");
  if (data.templates.length > MAX_TEMPLATES) throw new Error(`Библиотека может содержать не больше ${MAX_TEMPLATES} заготовок.`);
  const seen = new Set<string>();
  let total = 0;
  return data.templates.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Некорректная заготовка.");
    const template = raw as Record<string, unknown>;
    if (typeof template.id !== "string" || !template.id || template.id.length > 100 || seen.has(template.id)) throw new Error("Повторяющийся или некорректный ID заготовки.");
    seen.add(template.id);
    const name = templateName(template.name);
    if (!Array.isArray(template.items) || !template.items.length || template.items.length > MAX_ITEMS) throw new Error(`В заготовке должно быть от 1 до ${MAX_ITEMS} объектов.`);
    total += template.items.length;
    if (total > 10000) throw new Error("В библиотеке слишком много объектов (максимум 10000).");
    const document = emptyDocument();
    const imported = template.items.map((rawItem, index) => {
      if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) throw new Error("Некорректный объект заготовки.");
      const item = rawItem as Record<string, unknown>;
      if (item.kind === "room" || item.kind === "transition") throw new Error("Комнаты и переходы нельзя хранить в библиотеке объектов.");
      const portable = Object.fromEntries(transferableFields.filter(field => item[field] !== undefined).map(field => [field, structuredClone(item[field])]));
      if (![item.x, item.y, item.w, item.h].every(value => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e7)) throw new Error("Размеры или координаты заготовки слишком большие либо некорректны.");
      if (item.polygonPoints !== undefined && (!Array.isArray(item.polygonPoints) || item.polygonPoints.length > 256)) throw new Error("Контур заготовки может содержать до 256 вершин.");
      if (Array.isArray(item.polygonPoints) && item.polygonPoints.some(point => !point || typeof point !== "object" || ![point.x, point.y].every(value => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e7))) throw new Error("Некорректные координаты контура заготовки.");
      if (typeof item.label !== "string" || item.label.length > 10000) throw new Error("Некорректная подпись объекта заготовки.");
      if (typeof item.color !== "string" || !/^#[\da-f]{6}$/i.test(item.color)) throw new Error("Цвет объекта заготовки должен быть в формате #RRGGBB.");
      return { ...portable, id: `template-item-${index}`, layerId: document.layers[0].id,
        ...(item.blockingMode === undefined ? {} : { blocking: { roomId: null, mode: item.blockingMode } }) } as PlacedItem;
    });
    const valid = normalizeDocument({ ...document, items: imported }).items.map(cleanItem);
    const box = bounds(valid);
    return { id: template.id, name, width: box.width, height: box.height,
      items: valid.map(item => ({ ...item, x: item.x - box.x, y: item.y - box.y })) };
  });
}

/** Stable template IDs make repeated import idempotent; matching entries are refreshed. */
export function mergeTemplateLibraries(current: ObjectTemplate[], imported: ObjectTemplate[]): ObjectTemplate[] {
  const byId = new Map(current.map(template => [template.id, template]));
  for (const template of imported) byId.set(template.id, template);
  return parseTemplateLibrary(serializeTemplateLibrary([...byId.values()]));
}
