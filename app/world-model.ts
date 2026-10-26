export type WorldPoint = { x: number; y: number };
export type RoomType = "Normal" | "Combat" | "Secret" | "Boss" | "Save" | "Passage";
export type RoomStatus = "Planned" | "Blockout" | "InProgress" | "Ready";
export type TransitionType = "Passage" | "Door" | "Elevator" | "Teleport" | "Boundary";
export type Ability = "WallGrab" | "Dash" | "FallingAttack" | "DoubleJump";

export const ROOM_TYPES: Record<RoomType, string> = {
  Normal: "Исследование", Combat: "Бой", Secret: "Секрет", Boss: "Босс", Save: "Отдых", Passage: "Переход",
};
export const ROOM_STATUSES: Record<RoomStatus, string> = {
  Planned: "Запланирована", Blockout: "Блокинг", InProgress: "В работе", Ready: "Готова к проверке",
};
export const TRANSITION_TYPES: Record<TransitionType, string> = {
  Passage: "Проход", Door: "Дверь", Elevator: "Лифт", Teleport: "Телепорт", Boundary: "Граница комнаты",
};
export const ABILITIES: Record<Ability, string> = {
  WallGrab: "Зацеп за стену", Dash: "Рывок", FallingAttack: "Атака в падении", DoubleJump: "Двойной прыжок",
};

export type ArrivalSettings = {
  preservePlayerDepth: boolean;
  overrideFacing: boolean;
  faceRight: boolean;
  maximumPlacementAdjustmentCm: number;
};
export type WorldConnection = {
  enabled: boolean;
  targetRoomId: string | null;
  targetEntranceId: string | null;
  type: TransitionType;
  requiredTags: string[];
  blockedTags: string[];
  requiredAbilities: Ability[];
  fadeDuration: number;
};
export type WorldEntrance = ArrivalSettings & { id: string; name: string };
export type WorldExitGraphStyle = { color: string; lineStyle: "solid" | "dashed" };
export type WorldExit = ArrivalSettings & { id: string; name: string; connection: WorldConnection; graphStyle?: WorldExitGraphStyle };
export type WorldEndpoint = WorldEntrance | WorldExit;
export type WorldRegion = {
  id: string; name: string; description: string; color: string; graphPosition: WorldPoint;
};
export type WorldRoom = {
  id: string;
  name: string;
  description: string;
  regionId: string | null;
  graphPosition: WorldPoint;
  roomType: RoomType;
  status: RoomStatus;
  designSizeCm: { x: number; z: number };
  tags: string[];
  environmentTags: string[];
  shapeItemId?: string;
  blockingOrigin?: WorldPoint;
  entrances: WorldEntrance[];
  exits: WorldExit[];
};
export type WorldData = {
  id: string;
  regions: WorldRegion[];
  rooms: WorldRoom[];
  start: { roomId: string; entranceId: string } | null;
  startGraphPosition: WorldPoint;
  settings: { assetFolder: string; transitionTimeout: number; useRoomGraphForPlayerMap: boolean };
};
export type WorldIssue = {
  severity: "error" | "warning";
  message: string;
  roomId?: string;
  exitId?: string;
  entranceId?: string;
  regionId?: string;
  itemId?: string;
};

const arrivalDefaults = (): ArrivalSettings => ({
  preservePlayerDepth: true, overrideFacing: false, faceRight: true, maximumPlacementAdjustmentCm: 50,
});
const newId = () => crypto.randomUUID();

export function createEntrance(name = "Вход"): WorldEntrance {
  return { id: newId(), name, ...arrivalDefaults() };
}

export function createExit(name = "Выход"): WorldExit {
  return {
    id: newId(), name, ...arrivalDefaults(),
    connection: {
      enabled: false, targetRoomId: null, targetEntranceId: null, type: "Passage",
      requiredTags: [], blockedTags: [], requiredAbilities: [], fadeDuration: 0.8,
    },
  };
}

export function createRegion(name: string, position: WorldPoint = { x: 0, y: 0 }): WorldRegion {
  return { id: newId(), name, description: "", color: "#467fa8", graphPosition: { ...position } };
}

export function createRoom(name: string, position: WorldPoint = { x: 0, y: 0 }, regionId: string | null = null): WorldRoom {
  return {
    id: newId(), name, description: "", regionId, graphPosition: { ...position }, roomType: "Normal", status: "Planned",
    designSizeCm: { x: 4000, z: 2000 }, tags: [], environmentTags: [], entrances: [], exits: [],
  };
}

/** Legacy drawing geometry and item IDs remain untouched; graph placement has no physical scale. */
export function createWorld(shapes: { id: string; label: string; x: number; y: number; w: number; h: number }[] = []): WorldData {
  return {
    id: newId(), regions: [],
    rooms: shapes.map((shape, index) => ({
      ...createRoom(shape.label || `Комната ${index + 1}`, { x: 320 + (index % 4) * 360, y: Math.floor(index / 4) * 260 }),
      shapeItemId: shape.id,
    })),
    start: null, startGraphPosition: { x: 0, y: 0 },
    settings: { assetFolder: "/Game/Worlds", transitionTimeout: 45, useRoomGraphForPlayerMap: false },
  };
}

function invalid(path: string, expectation: string): never {
  throw new Error(`Некорректное поле «${path}»: ${expectation}.`);
}
function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(path, "ожидается объект");
  return value as Record<string, unknown>;
}
function string(value: unknown, path: string): string {
  if (typeof value !== "string") invalid(path, "ожидается строка");
  return value;
}
function nullableString(value: unknown, path: string): string | null {
  return value === null ? null : string(value, path);
}
function number(value: unknown, path: string, minimum = -Infinity): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum)
    invalid(path, minimum === -Infinity ? "ожидается конечное число" : `ожидается число не меньше ${minimum}`);
  return value;
}
function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path, "ожидается логическое значение");
  return value;
}
function array<T>(value: unknown, path: string, parse: (entry: unknown, entryPath: string) => T): T[] {
  if (!Array.isArray(value)) invalid(path, "ожидается список");
  return value.map((entry, index) => parse(entry, `${path}[${index + 1}]`));
}
function choice<T extends string>(value: unknown, path: string, choices: Record<T, string>): T {
  if (typeof value !== "string" || !Object.hasOwn(choices, value)) invalid(path, "неизвестное значение");
  return value as T;
}
function parsePoint(value: unknown, path: string): WorldPoint {
  const item = record(value, path);
  return { x: number(item.x, `${path}.x`), y: number(item.y, `${path}.y`) };
}
function parseArrival(item: Record<string, unknown>, path: string): ArrivalSettings {
  return {
    preservePlayerDepth: boolean(item.preservePlayerDepth, `${path}.preservePlayerDepth`),
    overrideFacing: boolean(item.overrideFacing, `${path}.overrideFacing`),
    faceRight: boolean(item.faceRight, `${path}.faceRight`),
    maximumPlacementAdjustmentCm: number(item.maximumPlacementAdjustmentCm, `${path}.maximumPlacementAdjustmentCm`, 0),
  };
}
function parseEntrance(value: unknown, path: string): WorldEntrance {
  const item = record(value, path);
  return { id: string(item.id, `${path}.id`), name: string(item.name, `${path}.name`), ...parseArrival(item, path) };
}
function parseConnection(value: unknown, path: string): WorldConnection {
  const item = record(value, path);
  return {
    enabled: boolean(item.enabled, `${path}.enabled`),
    targetRoomId: nullableString(item.targetRoomId, `${path}.targetRoomId`),
    targetEntranceId: nullableString(item.targetEntranceId, `${path}.targetEntranceId`),
    type: choice(item.type, `${path}.type`, TRANSITION_TYPES),
    requiredTags: array(item.requiredTags, `${path}.requiredTags`, string),
    blockedTags: array(item.blockedTags, `${path}.blockedTags`, string),
    requiredAbilities: array(item.requiredAbilities, `${path}.requiredAbilities`, (entry, entryPath) => choice(entry, entryPath, ABILITIES)),
    fadeDuration: number(item.fadeDuration, `${path}.fadeDuration`, 0),
  };
}

function parseExitGraphStyle(value: unknown, path: string): WorldExitGraphStyle {
  const item = record(value, path);
  const color = string(item.color, `${path}.color`);
  if (!/^#[\da-f]{6}$/i.test(color)) invalid(`${path}.color`, "ожидается цвет #RRGGBB");
  return { color, lineStyle: choice(item.lineStyle, `${path}.lineStyle`, { solid: "Сплошная", dashed: "Пунктирная" }) };
}

/** Strict field parsing protects the editor; semantic link errors remain editable and are reported separately. */
export function parseWorld(value: unknown): WorldData {
  const world = record(value, "Мир");
  const settings = record(world.settings, "Мир.settings");
  const start = world.start === null ? null : record(world.start, "Мир.start");
  return {
    id: string(world.id, "Мир.id"),
    regions: array(world.regions, "Мир.regions", (value, path) => {
      const item = record(value, path);
      const color = string(item.color, `${path}.color`);
      if (!/^#[\da-f]{6}$/i.test(color)) invalid(`${path}.color`, "ожидается цвет #RRGGBB");
      return {
        id: string(item.id, `${path}.id`), name: string(item.name, `${path}.name`),
        description: string(item.description, `${path}.description`), color,
        graphPosition: parsePoint(item.graphPosition, `${path}.graphPosition`),
      };
    }),
    rooms: array(world.rooms, "Мир.rooms", (value, path) => {
      const item = record(value, path);
      const size = record(item.designSizeCm, `${path}.designSizeCm`);
      return {
        id: string(item.id, `${path}.id`), name: string(item.name, `${path}.name`),
        description: string(item.description, `${path}.description`),
        regionId: nullableString(item.regionId, `${path}.regionId`),
        graphPosition: parsePoint(item.graphPosition, `${path}.graphPosition`),
        roomType: choice(item.roomType, `${path}.roomType`, ROOM_TYPES),
        status: choice(item.status, `${path}.status`, ROOM_STATUSES),
        designSizeCm: { x: number(size.x, `${path}.designSizeCm.x`, 1), z: number(size.z, `${path}.designSizeCm.z`, 1) },
        tags: array(item.tags, `${path}.tags`, string),
        environmentTags: array(item.environmentTags, `${path}.environmentTags`, string),
        ...(item.shapeItemId === undefined ? {} : { shapeItemId: string(item.shapeItemId, `${path}.shapeItemId`) }),
        ...(item.blockingOrigin === undefined ? {} : { blockingOrigin: parsePoint(item.blockingOrigin, `${path}.blockingOrigin`) }),
        entrances: array(item.entrances, `${path}.entrances`, parseEntrance),
        exits: array(item.exits, `${path}.exits`, (value, path) => {
          const exit = record(value, path);
          return { ...parseEntrance(value, path), connection: parseConnection(exit.connection, `${path}.connection`),
            ...(exit.graphStyle === undefined ? {} : { graphStyle: parseExitGraphStyle(exit.graphStyle, `${path}.graphStyle`) }) };
        }),
      };
    }),
    start: start === null ? null : { roomId: string(start.roomId, "Мир.start.roomId"), entranceId: string(start.entranceId, "Мир.start.entranceId") },
    startGraphPosition: parsePoint(world.startGraphPosition, "Мир.startGraphPosition"),
    settings: {
      assetFolder: string(settings.assetFolder, "Мир.settings.assetFolder"),
      transitionTimeout: number(settings.transitionTimeout, "Мир.settings.transitionTimeout", 5),
      useRoomGraphForPlayerMap: boolean(settings.useRoomGraphForPlayerMap, "Мир.settings.useRoomGraphForPlayerMap"),
    },
  };
}

const validId = (id: string) => /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)
  && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(id);

export function validateWorld(world: WorldData): WorldIssue[] {
  const issues: WorldIssue[] = [];
  const add = (severity: WorldIssue["severity"], message: string, target: Omit<WorldIssue, "severity" | "message"> = {}) => issues.push({ severity, message, ...target });
  const checkId = (id: string, seen: Set<string>, label: string, target: Omit<WorldIssue, "severity" | "message">) => {
    if (!validId(id)) add("error", `Некорректный ID: ${label}.`, target);
    if (seen.has(id)) add("error", `Повторяющийся ID: ${label}.`, target);
    seen.add(id);
  };
  if (!validId(world.id)) add("error", "Некорректный ID мира.");
  const regionIds = new Set<string>();
  const roomIds = new Set<string>();
  const entranceIds = new Set<string>();
  const exitIds = new Set<string>();
  const shapeIds = new Set<string>();
  for (const region of world.regions) checkId(region.id, regionIds, `регион «${region.name}»`, { regionId: region.id });
  const rooms = new Map(world.rooms.map(room => [room.id, room]));
  const neighbours = new Map(world.rooms.map(room => [room.id, new Set<string>()]));
  for (const room of world.rooms) {
    checkId(room.id, roomIds, `комната «${room.name}»`, { roomId: room.id });
    if (room.regionId !== null && !regionIds.has(room.regionId))
      add("warning", `У комнаты «${room.name}» отсутствует регион. Выберите другой или «Без региона».`, { roomId: room.id, regionId: room.regionId });
    if (room.shapeItemId) {
      if (shapeIds.has(room.shapeItemId)) add("error", `Форма блокинга назначена нескольким комнатам: «${room.name}».`, { roomId: room.id });
      shapeIds.add(room.shapeItemId);
    }
    for (const entrance of room.entrances)
      checkId(entrance.id, entranceIds, `вход «${entrance.name}» в «${room.name}»`, { roomId: room.id, entranceId: entrance.id });
    for (const exit of room.exits)
      checkId(exit.id, exitIds, `выход «${exit.name}» в «${room.name}»`, { roomId: room.id, exitId: exit.id });
    if (!room.entrances.length && !room.exits.length)
      add("warning", `В комнате «${room.name}» ещё нет входов и выходов.`, { roomId: room.id });
  }
  const occupied = new Set<string>();
  for (const room of world.rooms) for (const exit of room.exits) {
    const connection = exit.connection;
    if (!connection.enabled) continue;
    const target = connection.targetRoomId === null ? undefined : rooms.get(connection.targetRoomId);
    if (!target) {
      add("error", `У прохода «${room.name} / ${exit.name}» отсутствует целевая комната.`, { roomId: room.id, exitId: exit.id });
      continue;
    }
    const entrance = target.entrances.find(entry => entry.id === connection.targetEntranceId);
    if (!entrance) {
      add("error", `У прохода «${room.name} / ${exit.name}» отсутствует вход в «${target.name}».`, { roomId: room.id, exitId: exit.id });
      continue;
    }
    if (occupied.has(entrance.id))
      add("error", `К входу «${target.name} / ${entrance.name}» подключено несколько проходов.`, { roomId: target.id, entranceId: entrance.id });
    occupied.add(entrance.id);
    neighbours.get(room.id)?.add(target.id);
    neighbours.get(target.id)?.add(room.id);
    if (connection.requiredTags.some(tag => connection.blockedTags.includes(tag)))
      add("warning", `У прохода «${room.name} / ${exit.name}» один тег одновременно требуется и запрещён.`, { roomId: room.id, exitId: exit.id });
  }
  const startRoom = world.start ? rooms.get(world.start.roomId) : undefined;
  if (!world.start) add("warning", "Не задан старт игры. Выберите вход в стартовую комнату.");
  else if (!startRoom) add("error", "Старт игры ссылается на отсутствующую комнату.");
  else if (!startRoom.entrances.some(entrance => entrance.id === world.start?.entranceId))
    add("error", `Не найден стартовый вход в комнате «${startRoom.name}».`, { roomId: startRoom.id, entranceId: world.start.entranceId });
  if (startRoom) {
    // Passages are bidirectional. Gates are intentionally ignored: this is not progression simulation.
    const reachable = new Set([startRoom.id]);
    const queue = [startRoom.id];
    for (let index = 0; index < queue.length; index++) for (const neighbour of neighbours.get(queue[index]) ?? []) {
      if (!reachable.has(neighbour)) { reachable.add(neighbour); queue.push(neighbour); }
    }
    for (const room of world.rooms) if (!reachable.has(room.id))
      add("warning", `Комната «${room.name}» недостижима от старта по включённым проходам. Условия доступа не учитываются.`, { roomId: room.id });
  }
  return issues.sort((a, b) => Number(a.severity === "warning") - Number(b.severity === "warning"));
}

const disconnect = (connection: WorldConnection): WorldConnection => ({ ...connection, enabled: false, targetRoomId: null, targetEntranceId: null });

export function removeRegion(world: WorldData, regionId: string): WorldData {
  return {
    ...world, regions: world.regions.filter(region => region.id !== regionId),
    rooms: world.rooms.map(room => room.regionId === regionId ? { ...room, regionId: null } : room),
  };
}

export function removeRoom(world: WorldData, roomId: string): WorldData {
  return {
    ...world, start: world.start?.roomId === roomId ? null : world.start,
    rooms: world.rooms.filter(room => room.id !== roomId).map(room => ({
      ...room, exits: room.exits.map(exit => exit.connection.targetRoomId === roomId ? { ...exit, connection: disconnect(exit.connection) } : exit),
    })),
  };
}

export function removeEndpoint(world: WorldData, roomId: string, kind: "entrance" | "exit", endpointId: string): WorldData {
  return {
    ...world,
    start: kind === "entrance" && world.start?.roomId === roomId && world.start.entranceId === endpointId ? null : world.start,
    rooms: world.rooms.map(room => ({
      ...room,
      entrances: kind === "entrance" && room.id === roomId ? room.entrances.filter(entrance => entrance.id !== endpointId) : room.entrances,
      exits: room.exits.filter(exit => !(kind === "exit" && room.id === roomId && exit.id === endpointId)).map(exit =>
        kind === "entrance" && exit.connection.targetRoomId === roomId && exit.connection.targetEntranceId === endpointId
          ? { ...exit, connection: disconnect(exit.connection) } : exit),
    })),
  };
}

export function connectExit(world: WorldData, roomId: string, exitId: string, targetRoomId: string, targetEntranceId: string): WorldData {
  // Unreal GUID identity ignores case; retain the spelling of the actual source objects.
  const sameId = (left: string | null, right: string) => left?.toLowerCase() === right.toLowerCase();
  const source = world.rooms.find(room => sameId(room.id, roomId));
  const sourceExit = source?.exits.find(exit => sameId(exit.id, exitId));
  if (!source || !sourceExit) throw new Error("Исходный выход не найден.");
  const destination = world.rooms.find(room => sameId(room.id, targetRoomId));
  const entrance = destination?.entrances.find(entry => sameId(entry.id, targetEntranceId));
  if (!destination || !entrance) throw new Error("Целевой вход не найден.");
  const occupied = world.rooms.some(room => room.exits.some(exit =>
    !(room === source && exit === sourceExit) && exit.connection.enabled
      && sameId(exit.connection.targetRoomId, destination.id) && sameId(exit.connection.targetEntranceId, entrance.id)));
  if (occupied) throw new Error("Этот вход уже занят проходом. Выберите другой вход или отключите прежнюю связь.");
  return {
    ...world, rooms: world.rooms.map(room => room !== source ? room : {
      ...room, exits: room.exits.map(exit => exit !== sourceExit ? exit : {
        ...exit, connection: { ...exit.connection, enabled: true, targetRoomId: destination.id, targetEntranceId: entrance.id },
      }),
    }),
  };
}
