import { normalizeDocument, type MapDocument, type PlacedItem } from "./map-document";
import { validateWorld, type WorldData, type WorldIssue } from "./world-model";
import { createBlockingSettings, validateBlocking } from "./blocking-model";

export type UnrealExportOptions = {
  roomContours: boolean;
  geometry: boolean;
  objects: boolean;
  enemies: boolean;
  logic: boolean;
};
export type UnrealExportCategory = Exclude<keyof UnrealExportOptions, "logic">;
export type UnrealExportDocument = Omit<MapDocument, "version"> & {
  version: 3;
  format: "mapconstructor-unreal";
  exportScope: UnrealExportOptions & { version: 1 };
};
export type UnrealExportReview<TDocument = MapDocument> = {
  document: TDocument | null;
  issues: WorldIssue[];
  errors: WorldIssue[];
  warnings: WorldIssue[];
};

export function defaultUnrealExportOptions(): UnrealExportOptions {
  return { roomContours: true, geometry: true, objects: true, enemies: true, logic: true };
}

/** Categories follow the explicit import mode; layer visibility never changes export ownership. */
export function getUnrealExportCategory(item: Pick<PlacedItem, "kind" | "blocking">): UnrealExportCategory | null {
  const mode = item.blocking?.mode;
  if (mode === "solid" || mode === "outline") return item.kind === "room" ? "roomContours" : "geometry";
  if (mode === "blueprint") return item.kind === "enemy" || item.kind === "boss" ? "enemies" : "objects";
  return null;
}

function parseOptions(value: UnrealExportOptions): UnrealExportOptions {
  const result = defaultUnrealExportOptions();
  for (const key of Object.keys(result) as (keyof UnrealExportOptions)[]) {
    if (!value || typeof value[key] !== "boolean") throw new Error(`Настройка экспорта «${key}» должна быть логическим значением.`);
    result[key] = value[key];
  }
  return result;
}

/** Editor appearance must not change the serialized engine payload or its reimport fingerprint. */
function withoutGraphAppearance(source: MapDocument): MapDocument {
  const portableSource = { ...source };
  delete portableSource.routes;
  return { ...portableSource, world: { ...source.world, rooms: source.world.rooms.map(room => ({ ...room,
    exits: room.exits.map(exit => {
      if (exit.graphStyle === undefined) return exit;
      const portable = { ...exit };
      delete portable.graphStyle;
      return portable;
    }),
  })) } };
}

/** A transfer is a projection, never an editable replacement for its complete source project. */
function projectForUnreal(source: MapDocument, scope: UnrealExportOptions): MapDocument {
  const selected = source.items.filter(item => {
    const category = getUnrealExportCategory(item);
    return category !== null && scope[category];
  });
  const shapeIds = new Set(selected.filter(item => item.kind === "room").map(item => item.id));
  const items = selected.map(item => {
    if (!item.attachedRoomId || shapeIds.has(item.attachedRoomId)) return item;
    const detached = { ...item };
    delete detached.attachedRoomId;
    return detached;
  });
  return {
    ...source,
    items,
    paths: [],
    blocking: { ...(source.blocking ?? createBlockingSettings()),
      enabled: scope.roomContours || scope.geometry || scope.objects || scope.enemies },
    world: scope.logic ? source.world : { ...source.world, start: null, startGraphPosition: { x: 0, y: 0 },
      rooms: source.world.rooms.map(room => ({ ...room, entrances: [], exits: [] })) },
  };
}

// Mirrors UE 5.8 INVALID_LONGPACKAGE_CHARACTERS and IsValidTextForLongPackageName.
const invalidPackageCharacters = new Set("\\:*?\"<>|' ,.&!~\n\r\t@#");
const maximumFloat = 3.4028234663852886e38;

function checkNumericRange(value: unknown, path: string, issues: WorldIssue[]): void {
  if (typeof value === "number" && Math.abs(value) > maximumFloat)
    issues.push({ severity: "error", message: `Поле «${path}» выходит за числовой диапазон импортера Unreal.` });
  else if (Array.isArray(value)) value.forEach((item, index) => checkNumericRange(item, `${path}[${index + 1}]`, issues));
  else if (value !== null && typeof value === "object")
    Object.entries(value).forEach(([key, item]) => checkNumericRange(item, `${path}.${key}`, issues));
}

function checkDisabledTargets(world: WorldData, issues: WorldIssue[]): void {
  const rooms = new Map(world.rooms.map(room => [room.id, room]));
  for (const room of world.rooms) for (const exit of room.exits) {
    const connection = exit.connection;
    if (connection.enabled || (connection.targetRoomId === null && connection.targetEntranceId === null)) continue;
    const target = connection.targetRoomId === null ? undefined : rooms.get(connection.targetRoomId);
    if (!target) issues.push({ severity: "error", roomId: room.id, exitId: exit.id,
      message: `Отключённый проход «${room.name} / ${exit.name}» ссылается на отсутствующую комнату.` });
    else if (connection.targetEntranceId === null) issues.push({ severity: "warning", roomId: room.id, exitId: exit.id,
      message: `В проходе «${room.name} / ${exit.name}» выбрана комната «${target.name}», но ещё не выбран вход. Черновик сохранится; проход останется отключённым.` });
    else if (!target.entrances.some(entrance => entrance.id === connection.targetEntranceId))
      issues.push({ severity: "error", roomId: room.id, exitId: exit.id,
        message: `Отключённый проход «${room.name} / ${exit.name}» ссылается на отсутствующий вход в «${target.name}».` });
  }
}

/** FGuid identity is case-insensitive. Keep source spelling in the exported document. */
function worldForValidation(world: WorldData): WorldData {
  return {
    ...world,
    id: world.id.toLowerCase(),
    regions: world.regions.map(region => ({ ...region, id: region.id.toLowerCase() })),
    rooms: world.rooms.map(room => ({
      ...room,
      id: room.id.toLowerCase(),
      regionId: room.regionId?.toLowerCase() ?? null,
      // Drawing bindings are outside the metadata import contract.
      shapeItemId: undefined,
      entrances: room.entrances.map(entrance => ({ ...entrance, id: entrance.id.toLowerCase() })),
      exits: room.exits.map(exit => ({
        ...exit, id: exit.id.toLowerCase(), connection: {
          ...exit.connection,
          targetRoomId: exit.connection.targetRoomId?.toLowerCase() ?? null,
          targetEntranceId: exit.connection.targetEntranceId?.toLowerCase() ?? null,
        },
      })),
    })),
    start: world.start ? { roomId: world.start.roomId.toLowerCase(), entranceId: world.start.entranceId.toLowerCase() } : null,
  };
}

/** No-options calls retain legacy v2 review. Scoped transfers use v3 so old importers fail closed. */
export function buildUnrealExport(input: unknown): UnrealExportReview<MapDocument>;
export function buildUnrealExport(input: unknown, options: UnrealExportOptions): UnrealExportReview<UnrealExportDocument>;
export function buildUnrealExport(input: unknown, options?: UnrealExportOptions): UnrealExportReview<MapDocument | UnrealExportDocument> {
  let document: MapDocument | UnrealExportDocument | null = null;
  const issues: WorldIssue[] = [];
  try {
    if (input === null || typeof input !== "object" || !("version" in input) || input.version !== 2)
      throw new Error("Для Unreal нужен проект версии 2. Сначала откройте старую схему в конструкторе и сохраните обновлённый проект: это закрепит постоянные ID комнат.");
    const source = withoutGraphAppearance(normalizeDocument(input));
    const scope = options === undefined ? undefined : parseOptions(options);
    const projected = scope ? projectForUnreal(source, scope) : source;
    document = scope ? { ...projected, version: 3, format: "mapconstructor-unreal", exportScope: { version: 1, ...scope } } : projected;
    const world = worldForValidation(projected.world);
    // Intentionally omitted logic must not produce missing-start or missing-endpoint diagnostics.
    issues.push(...validateWorld(world).filter(issue => scope?.logic !== false || issue.severity === "error" || issue.regionId !== undefined));
    issues.push(...validateBlocking(projected));
    if (scope?.logic !== false) checkDisabledTargets(world, issues);
    // Canvas coordinates are doubles. Only converted blocking coordinates have a physical bound.
    checkNumericRange({ ...world, rooms: world.rooms.map(room => ({ ...room, blockingOrigin: undefined })) }, "world", issues);
    const folder = world.settings.assetFolder;
    if (!/^\/Game\//i.test(folder) || folder.endsWith("/") || folder.includes("//")
      || [...folder].some(character => invalidPackageCharacters.has(character) || character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
      issues.push({ severity: "error", message: "Папка создания ассетов должна иметь вид /Game/Worlds: без завершающего слеша, двойных слешей, пробелов и запрещённых символов имени пакета Unreal." });
    const regions = new Set(world.regions.map(region => region.id));
    for (const room of world.rooms) if (room.regionId !== null && !regions.has(room.regionId)) {
      // The interactive editor allows repairing a missing optional group; an import must be unambiguous.
      const issue = issues.find(issue => issue.roomId === room.id && issue.regionId === room.regionId);
      if (issue) issue.severity = "error";
    }
    if (scope) issues.push({ severity: "warning", message: "Это файл передачи в Unreal, а не полный проект для редактирования. Каталог мира и постоянные ID сохраняются. Исключённые категории остаются без изменений в движке; удаление проверяется только внутри выбранных категорий. Положение карточек не задаёт координаты уровня." });
    else issues.push({ severity: "warning", message: document.blocking?.enabled
        ? "Импорт переносит каталог мира, явно назначенную геометрию и точки размещения Blueprint. Классы Blueprint выбираются в Unreal; игровые настройки рисунка не передаются. Положение карточек не задаёт координаты уровня."
        : "Этот этап импорта переносит каталог мира и карты-заготовки комнат. Геометрия, вода, враги, двери и другие объекты блокинга сохраняются в JSON, но пока не создаются в Unreal. Положение карточек не задаёт координаты уровня." });
  } catch (error) {
    issues.push({ severity: "error", message: error instanceof Error ? error.message : "Не удалось проверить проект для Unreal." });
  }
  const errors = issues.filter(issue => issue.severity === "error");
  const warnings = issues.filter(issue => issue.severity === "warning");
  return { document, issues: [...errors, ...warnings], errors, warnings };
}
