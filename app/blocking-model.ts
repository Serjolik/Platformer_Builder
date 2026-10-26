import type { MapDocument, PlacedItem, PlatformMode, Point, PrimitiveKind, SideType } from "./map-document";
import type { WorldIssue } from "./world-model";

export type BlockingMode = "solid" | "outline" | "blueprint" | "none";
export type BlockingSettings = { version: 1; enabled: boolean; centimetersPerCell: number; depthCm: number; wallThicknessCm: number };
export type ItemBlocking = { roomId: string | null; mode: BlockingMode };
export type BlockingVertex = { x: number; z: number };
export type PreparedBlockingObject = {
  sourceId: string;
  roomId: string;
  mode: "solid" | "outline";
  locationCm: { x: number; y: number; z: number };
  localVerticesCm: BlockingVertex[];
  sideTypes: SideType[];
  depthCm: number;
  wallThicknessCm: number;
};
export type PreparedBlockingEntity = {
  sourceId: string;
  kind: PrimitiveKind;
  roomId: string;
  locationCm: { x: number; y: 0; z: number };
};
export type PreparedBlocking = { objects: PreparedBlockingObject[]; entities: PreparedBlockingEntity[]; issues: WorldIssue[] };

const blueprintKinds = new Set<PrimitiveKind>(["enemy", "boss", "player", "npc", "platform", "moving", "hazard", "ladder", "vine", "spawn", "goal", "key", "door", "secret", "checkpoint", "loot", "liquid"]);
export function supportsBlueprintPlacement(kind: PrimitiveKind): boolean { return blueprintKinds.has(kind); }
/** Suggested mode for an explicit creation/assignment action, never a legacy migration default. */
export function defaultItemBlockingMode(kind: PrimitiveKind, platformMode?: PlatformMode): BlockingMode {
  if (kind === "room") return "outline";
  if (kind === "platform" && (platformMode ?? "normal") === "normal") return "solid";
  return supportsBlueprintPlacement(kind) ? "blueprint" : "none";
}

/** An explicit OneWay edit must not leave an existing solid-collision assignment behind. */
export function setItemPlatformMode(item: PlacedItem, platformMode: PlatformMode): PlacedItem {
  return { ...item, platformMode,
    ...(platformMode === "oneway" && item.blocking?.mode === "solid"
      ? { blocking: { ...item.blocking, mode: "blueprint" as const } } : {}),
  };
}

export function createBlockingSettings(): BlockingSettings {
  return { version: 1, enabled: false, centimetersPerCell: 100, depthCm: 200, wallThicknessCm: 20 };
}
export function getBlockingSettings(document: Pick<MapDocument, "blocking">): BlockingSettings {
  return document.blocking ? { ...document.blocking } : createBlockingSettings();
}
export function getItemBlocking(item: Pick<PlacedItem, "blocking">): ItemBlocking {
  return item.blocking ? { ...item.blocking } : { roomId: null, mode: "none" };
}
/** Only explicit user actions call this helper; spatial overlap never establishes ownership. */
export function assignItemBlocking(item: PlacedItem, roomId: string | null, mode: BlockingMode): PlacedItem {
  return { ...item, blocking: { roomId, mode } };
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Поле «${path}» должно быть объектом.`);
  return value as Record<string, unknown>;
}
function boundedNumber(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum)
    throw new Error(`Поле «${path}» должно быть конечным числом от ${minimum} до ${maximum}.`);
  return value;
}
export function parseBlockingSettings(value: unknown, path = "blocking"): BlockingSettings {
  const settings = object(value, path);
  if (settings.version !== 1) throw new Error(`Неподдерживаемая версия «${path}.version». Ожидается 1.`);
  if (typeof settings.enabled !== "boolean") throw new Error(`Поле «${path}.enabled» должно быть логическим значением.`);
  return {
    version: 1, enabled: settings.enabled,
    centimetersPerCell: boundedNumber(settings.centimetersPerCell, `${path}.centimetersPerCell`, .01, 1e6),
    depthCm: boundedNumber(settings.depthCm, `${path}.depthCm`, .1, 1e6),
    wallThicknessCm: boundedNumber(settings.wallThicknessCm, `${path}.wallThicknessCm`, .1, 1e6),
  };
}
export function parseItemBlocking(value: unknown, path = "Объект.blocking"): ItemBlocking {
  const binding = object(value, path);
  if (binding.roomId !== null && typeof binding.roomId !== "string") throw new Error(`Поле «${path}.roomId» должно быть ID комнаты или null.`);
  if (binding.mode !== "none" && binding.mode !== "solid" && binding.mode !== "outline" && binding.mode !== "blueprint") throw new Error(`Неизвестный режим «${path}.mode».`);
  return { roomId: binding.roomId as string | null, mode: binding.mode };
}

function localPolygon(item: PlacedItem): Point[] {
  return item.polygonPoints?.map(point => ({ ...point })) ?? [
    { x: 0, y: 0 }, { x: item.w * 32, y: 0 }, { x: item.w * 32, y: item.h * 32 }, { x: 0, y: item.h * 32 },
  ];
}
export function getItemPolygonPixels(item: PlacedItem): Point[] {
  return localPolygon(item).map(point => ({ x: item.x + point.x, y: item.y + point.y }));
}
function localBlueprintAnchor(item: PlacedItem): Point {
  if (!item.polygonPoints) return { x: item.w * 16, y: item.h * 32 };
  let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of item.polygonPoints) {
    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
  }
  return { x: minX * .5 + maxX * .5, y: maxY };
}
/** Canvas marker only. Blueprint dimensions and scale remain authored in Unreal. */
export function getItemBlueprintAnchorPixels(item: PlacedItem): Point {
  const anchor = localBlueprintAnchor(item);
  return { x: item.x + anchor.x, y: item.y + anchor.y };
}

const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const crossTolerance = 1e-6;
const pointTolerance = 1e-6;
function onSegment(point: Point, a: Point, b: Point): boolean {
  return Math.abs(cross(a, b, point)) <= crossTolerance
    && point.x >= Math.min(a.x, b.x) - pointTolerance && point.x <= Math.max(a.x, b.x) + pointTolerance
    && point.y >= Math.min(a.y, b.y) - pointTolerance && point.y <= Math.max(a.y, b.y) + pointTolerance;
}
function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const first = cross(a, b, c), second = cross(a, b, d), third = cross(c, d, a), fourth = cross(c, d, b);
  if (((first > crossTolerance && second < -crossTolerance) || (first < -crossTolerance && second > crossTolerance))
    && ((third > crossTolerance && fourth < -crossTolerance) || (third < -crossTolerance && fourth > crossTolerance))) return true;
  return onSegment(c, a, b) || onSegment(d, a, b) || onSegment(a, c, d) || onSegment(b, c, d);
}
function polygonProblem(points: Point[], minimumEdge: number, minimumArea: number): string | null {
  if (points.length < 3 || points.length > 256) return "контур должен содержать от 3 до 256 вершин";
  if (points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return "координаты контура должны быть конечными числами";
  for (let index = 0; index < points.length; index++) {
    const previous = points[(index + points.length - 1) % points.length];
    const point = points[index], next = points[(index + 1) % points.length];
    if (Math.hypot(next.x - point.x, next.y - point.y) < minimumEdge) return "контур содержит слишком короткую или нулевую сторону";
    if (Math.abs(cross(previous, point, next)) <= crossTolerance
      && (point.x - previous.x) * (next.x - point.x) + (point.y - previous.y) * (next.y - point.y) < 0)
      return "соседние стороны контура возвращаются по одной линии назад";
    for (let other = index + 1; other < points.length; other++) {
      if (other === index + 1 || (index === 0 && other === points.length - 1)) continue;
      if (segmentsIntersect(point, next, points[other], points[(other + 1) % points.length])) return "контур пересекает или касается сам себя";
    }
  }
  let twiceArea = 0;
  for (let index = 1; index + 1 < points.length; index++) twiceArea += cross(points[0], points[index], points[index + 1]);
  if (Math.abs(twiceArea) / 2 < minimumArea) return "контур имеет нулевую или слишком маленькую площадь";
  return null;
}
/** Pixel-space authoring helper. Physical import uses centimetre tolerances below. */
export function isSimplePolygon(points: Point[]): boolean {
  return polygonProblem(points, 1e-6, 1e-6) === null;
}
function containsPoint(points: Point[], point: Point): boolean {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const a = points[previous], b = points[index];
    if (onSegment(point, a, b)) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
/** Includes boundary contact; samples every edge interval cut by the outline, so concavities remain safe. */
export function polygonContainsPolygon(container: Point[], subject: Point[]): boolean {
  if (!isSimplePolygon(container) || !isSimplePolygon(subject) || subject.some(point => !containsPoint(container, point))) return false;
  for (let index = 0; index < subject.length; index++) {
    const a = subject[index], b = subject[(index + 1) % subject.length];
    const dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy;
    const cuts = [0, 1];
    for (let edge = 0; edge < container.length; edge++) {
      const c = container[edge], d = container[(edge + 1) % container.length];
      const denominator = dx * (d.y - c.y) - dy * (d.x - c.x);
      if (Math.abs(denominator) > crossTolerance) {
        const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / denominator;
        const u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / denominator;
        if (t > 0 && t < 1 && u >= -pointTolerance && u <= 1 + pointTolerance) cuts.push(t);
      } else if (Math.abs(cross(a, b, c)) <= crossTolerance) {
        for (const point of [c, d]) {
          const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
          if (t > 0 && t < 1) cuts.push(t);
        }
      }
    }
    cuts.sort((left, right) => left - right);
    for (let cut = 1; cut < cuts.length; cut++) {
      const t = (cuts[cut - 1] + cuts[cut]) / 2;
      if (!containsPoint(container, { x: a.x + dx * t, y: a.y + dy * t })) return false;
    }
  }
  return true;
}

/** Pure conversion. It neither assigns rooms nor changes existing source IDs or drawing coordinates. */
export function prepareBlocking(document: MapDocument): PreparedBlocking {
  const objects: PreparedBlockingObject[] = [];
  const entities: PreparedBlockingEntity[] = [];
  const issues: WorldIssue[] = [];
  let settings: BlockingSettings;
  try { settings = document.blocking ? parseBlockingSettings(document.blocking) : createBlockingSettings(); }
  catch (error) { return { objects, entities, issues: [{ severity: "error", message: error instanceof Error ? error.message : "Некорректные настройки блокинга." }] }; }
  if (!settings.enabled) return { objects, entities, issues };
  const rooms = new Map(document.world.rooms.map(room => [room.id.toLowerCase(), room]));
  const scale = settings.centimetersPerCell / 32;
  let skipped = 0;
  let oneWayEntities = 0;
  let movingEntities = 0;
  for (const item of document.items) {
    let binding: ItemBlocking;
    try { binding = item.blocking ? parseItemBlocking(item.blocking) : { roomId: null, mode: "none" }; }
    catch (error) { issues.push({ severity: "error", itemId: item.id, message: `${item.label}: ${error instanceof Error ? error.message : "некорректная принадлежность блокинга"}` }); continue; }
    if (binding.mode === "none") { skipped++; continue; }
    const fail = (message: string) => issues.push({ severity: "error", itemId: item.id, roomId: binding.roomId ?? undefined, message: `«${item.label}»: ${message}.` });
    if (item.kind === "platform" && item.platformMode === "oneway" && binding.mode === "solid") {
      fail("OneWay нельзя импортировать как сплошной блок: выберите «Разместить Blueprint» с нужной односторонней коллизией или отключите импорт объекта"); continue;
    }
    if (item.kind === "moving" && binding.mode === "solid") {
      fail("движущуюся платформу нельзя импортировать как неподвижный сплошной блок: выберите «Разместить Blueprint» или отключите импорт объекта"); continue;
    }
    if (item.kind === "transition") { fail("переход задаёт вход или выход мира и не является физическим объектом"); continue; }
    const room = binding.roomId === null ? undefined : rooms.get(binding.roomId.toLowerCase());
    if (!room) { fail("не назначена существующая комната для импорта блокинга"); continue; }
    if (!room.blockingOrigin || !Number.isFinite(room.blockingOrigin.x) || !Number.isFinite(room.blockingOrigin.y)) { fail(`у комнаты «${room.name}» не задано начало координат блокинга`); continue; }
    if (binding.mode === "blueprint") {
      if (!supportsBlueprintPlacement(item.kind)) { fail("размещение Blueprint недоступно для контура комнаты, заметки или комментария"); continue; }
      const anchor = localBlueprintAnchor(item);
      const location = { x: ((item.x - room.blockingOrigin.x) + anchor.x) * scale, y: 0 as const,
        z: -((item.y - room.blockingOrigin.y) + anchor.y) * scale };
      if ([location.x, location.z].some(value => !Number.isFinite(value) || Math.abs(value) > 1e7)) {
        fail("после пересчёта якорь Blueprint выходит за диапазон ±10000000 см"); continue;
      }
      entities.push({ sourceId: item.id, kind: item.kind, roomId: room.id, locationCm: location });
      if (item.kind === "platform" && item.platformMode === "oneway") oneWayEntities++;
      if (item.kind === "moving") movingEntities++;
      continue;
    }
    if (binding.mode === "outline" && item.kind !== "room") { fail("режим стен по контуру доступен только форме комнаты"); continue; }
    if (binding.mode === "solid" && item.kind === "room") { fail("форму комнаты нельзя заполнять сплошной коллизией; выберите стены по контуру"); continue; }
    const vertices = localPolygon(item).map(point => ({ x: point.x * scale, z: -point.y * scale }));
    const location = { x: (item.x - room.blockingOrigin.x) * scale, y: 0, z: -(item.y - room.blockingOrigin.y) * scale };
    if ([location.x, location.z, ...vertices.flatMap(point => [point.x, point.z])].some(value => !Number.isFinite(value) || Math.abs(value) > 1e7)) {
      fail("после пересчёта локальные вершины или положение выходят за диапазон ±10000000 см"); continue;
    }
    const problem = polygonProblem(vertices.map(point => ({ x: point.x, y: point.z })), .01, .01);
    if (problem) { fail(problem); continue; }
    if (binding.mode === "outline" && item.sideTypes !== undefined && item.sideTypes.length !== vertices.length) { fail("число типов сторон не совпадает с числом вершин контура"); continue; }
    const sideTypes: SideType[] = vertices.map((_, index) => item.sideTypes?.[index] ?? "straight");
    if (binding.mode === "outline" && sideTypes.includes("waves")) { fail("волнистая сторона не поддерживается для стен комнаты"); continue; }
    if (binding.mode === "outline" && sideTypes.some(side => side === "door" || side === "opening"))
      issues.push({ severity: "warning", itemId: item.id, roomId: room.id, message: `«${item.label}»: стороны «Дверь» и «Проход» целиком останутся открытыми. Для дверного актора нужен отдельный объект «Дверь» в режиме Blueprint.` });
    if (binding.mode === "outline" && sideTypes.includes("breakable"))
      issues.push({ severity: "warning", itemId: item.id, roomId: room.id, message: `«${item.label}»: ломаемые стороны создаются как обычные стены блокинга без механики разрушения.` });
    if (binding.mode === "solid" && (item.kind !== "platform" || (item.platformMode !== undefined && item.platformMode !== "normal")))
      issues.push({ severity: "warning", itemId: item.id, roomId: room.id, message: `«${item.label}»: создаётся только неподвижная сплошная коллизия; поведение ${item.kind === "liquid" ? "жидкости" : "игрового объекта"} не переносится.` });
    objects.push({ sourceId: item.id, roomId: room.id, mode: binding.mode, locationCm: location,
      localVerticesCm: vertices, sideTypes, depthCm: settings.depthCm, wallThicknessCm: settings.wallThicknessCm });
  }
  if (oneWayEntities) issues.push({ severity: "warning", message: `Платформы OneWay: ${oneWayEntities}. Режим сохранён как замысел; импорт размещает Blueprint типа platform. Проход снизу, коллизия и размеры должны быть настроены в выбранном Blueprint. Подтип платформы автоматически не переносится.` });
  if (movingEntities) issues.push({ severity: "warning", message: `Движущиеся платформы: ${movingEntities}. Blueprint размещается у нижнего центра рамки пути. Размеры платформы, крайние точки A/B и положение на пути сохранены в JSON как замысел, но не применяются к Blueprint; движение и габариты нужно настроить в Unreal.` });
  if (entities.length) issues.push({ severity: "warning", message: `Размещение Blueprint: ${entities.length} объектов. Классы по типам выбираются в Unreal; якорь — нижний центр габаритов. Размер и логика берутся из Blueprint: параметры ключей, урона и других механик из рисунка не передаются.` });
  if (skipped || document.paths.length) issues.push({ severity: "warning", message: `Без физического импорта: ${skipped} объектов без назначенного режима и ${document.paths.length} линий/стрелок. Они сохраняются в JSON.` });
  if (!objects.length && !entities.length && !issues.some(issue => issue.severity === "error")) issues.push({ severity: "warning", message: "Импорт блокинга включён, но нет объектов с назначенными комнатой и режимом импорта." });
  return { objects, entities, issues };
}
export function validateBlocking(document: MapDocument): WorldIssue[] { return prepareBlocking(document).issues; }
