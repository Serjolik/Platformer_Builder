import type { MapDocument, PlacedItem } from "./map-document";
import type { WorldData, WorldEndpoint, WorldEntrance, WorldExit, WorldRoom } from "./world-model";

export type RoomTransitionKind = "entrance" | "exit";
export type RoomTransitionBinding = { endpointId: string; kind: RoomTransitionKind };
type BoundTransition = { itemId: string; sideIndex?: number; binding: RoomTransitionBinding; roomId: string };
const key = (id: string) => id.toLowerCase();
const sameId = (left: string | null | undefined, right: string) => left !== null && left !== undefined && key(left) === key(right);
const validId = (id: string) => /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)
  && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(id);
const sideCount = (item: PlacedItem) => item.polygonPoints?.length ?? 4;
const eligibleSide = (item: PlacedItem, index: number) => item.kind === "room" && Number.isInteger(index)
  && index >= 0 && index < sideCount(item) && (item.sideTypes?.[index] === "door" || item.sideTypes?.[index] === "opening");

export function parseRoomTransitionBinding(value: unknown, path = "Переход"): RoomTransitionBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path}: ожидается привязка перехода.`);
  const binding = value as Record<string, unknown>;
  if (typeof binding.endpointId !== "string" || !validId(binding.endpointId)) throw new Error(`${path}: нужен постоянный GUID точки перехода.`);
  if (binding.kind !== "entrance" && binding.kind !== "exit") throw new Error(`${path}: роль должна быть entrance или exit.`);
  return { endpointId: binding.endpointId, kind: binding.kind };
}

/** Follow/move attachment and spatial containment do not establish semantic room ownership. */
export function getRoomTransitionOwner(document: MapDocument, item: PlacedItem): WorldRoom | null {
  if (item.blocking?.roomId) return document.world.rooms.find(room => sameId(room.id, item.blocking!.roomId!)) ?? null;
  if (item.kind !== "room") return null;
  const owners = document.world.rooms.filter(room => room.shapeItemId === item.id);
  return owners.length === 1 ? owners[0] : null;
}

export function getRoomTransitionBinding(item: PlacedItem, sideIndex?: number): RoomTransitionBinding | null {
  return sideIndex === undefined ? item.transition ?? null : item.sideTransitions?.[sideIndex] ?? null;
}

function endpoint(world: WorldData, binding: BoundTransition): WorldEndpoint | undefined {
  const room = world.rooms.find(room => sameId(room.id, binding.roomId));
  return (binding.binding.kind === "entrance" ? room?.entrances : room?.exits)?.find(point => sameId(point.id, binding.binding.endpointId));
}

export function getRoomTransitionEndpoint(document: MapDocument, item: PlacedItem, sideIndex?: number): WorldEndpoint | null {
  const owner = getRoomTransitionOwner(document, item), binding = getRoomTransitionBinding(item, sideIndex);
  return owner && binding ? endpoint(document.world, { itemId: item.id, sideIndex, roomId: owner.id, binding }) ?? null : null;
}

export function clearItemTransitions(item: PlacedItem): PlacedItem {
  if (!item.transition && !item.sideTransitions) return item;
  const result = { ...item };
  delete result.transition;
  delete result.sideTransitions;
  return result;
}

function withBinding(item: PlacedItem, binding: RoomTransitionBinding | null, sideIndex?: number): PlacedItem {
  if (sideIndex === undefined) {
    const result = { ...item };
    if (binding) result.transition = binding; else delete result.transition;
    return result;
  }
  const sides = Array.from({ length: sideCount(item) }, (_, index) => item.sideTransitions?.[index] ?? null);
  sides[sideIndex] = binding;
  return { ...item, sideTransitions: sides };
}

function inventory(document: MapDocument): BoundTransition[] {
  const result: BoundTransition[] = [];
  const seen = new Set<string>();
  for (const item of document.items) {
    const add = (raw: RoomTransitionBinding, sideIndex?: number) => {
      const binding = parseRoomTransitionBinding(raw, `Переход «${item.label}»`);
      if (sideIndex === undefined ? item.kind !== "transition" : !eligibleSide(item, sideIndex))
        throw new Error(`«${item.label}»: переход можно назначить маркеру перехода или стороне комнаты «Дверь»/«Проход».`);
      const room = getRoomTransitionOwner(document, item);
      if (!room) throw new Error(`«${item.label}»: для перехода нужна одна существующая комната-владелец.`);
      if (seen.has(key(binding.endpointId))) throw new Error(`«${item.label}»: одна точка перехода привязана к нескольким объектам или сторонам.`);
      seen.add(key(binding.endpointId));
      result.push({ itemId: item.id, sideIndex, binding, roomId: room.id });
    };
    if (item.transition !== undefined) add(item.transition);
    if (item.sideTransitions !== undefined) {
      if (item.kind !== "room" || !Array.isArray(item.sideTransitions) || item.sideTransitions.length !== sideCount(item))
        throw new Error(`«${item.label}»: число привязок сторон должно совпадать с числом сторон комнаты.`);
      item.sideTransitions.forEach((binding, index) => { if (binding !== null) add(binding, index); });
    }
  }
  return result;
}

/** Loading verifies persisted identities; it never repairs a missing point by inventing an ID. */
export function validateRoomTransitionBindings(document: MapDocument): void {
  for (const binding of inventory(document)) if (!endpoint(document.world, binding))
    throw new Error(`Переход «${document.items.find(item => item.id === binding.itemId)?.label}»: связанная точка отсутствует в комнате. Откройте полный согласованный проект.`);
}

function cleanIneligibleBindings(document: MapDocument): MapDocument {
  let changed = false;
  const items = document.items.map(item => {
    let result = item;
    if (item.transition && (item.kind !== "transition" || !getRoomTransitionOwner(document, item))) result = withBinding(result, null);
    if (item.sideTransitions) {
      if (item.sideTransitions.length !== sideCount(item)) throw new Error(`«${item.label}»: при изменении контура нужно сохранить соответствие привязок сторон.`);
      const sides = item.sideTransitions.map((binding, index) => binding && (!eligibleSide(item, index) || !getRoomTransitionOwner(document, item)) ? null : binding);
      if (sides.some((binding, index) => binding !== item.sideTransitions![index])) result = { ...result, sideTransitions: sides };
      if (result.kind !== "room") { result = { ...result }; delete result.sideTransitions; }
    }
    changed ||= result !== item;
    return result;
  });
  return changed ? { ...document, items } : document;
}

function updateRoom(world: WorldData, id: string, update: (room: WorldRoom) => WorldRoom): WorldData {
  let changed = false;
  const rooms = world.rooms.map(room => {
    const result = sameId(room.id, id) ? update(room) : room;
    changed ||= result !== room;
    return result;
  });
  return changed ? { ...world, rooms } : world;
}

function redirectEntrance(world: WorldData, from: BoundTransition, to?: BoundTransition): WorldData {
  let changed = false;
  const rooms = world.rooms.map(room => {
    let roomChanged = false;
    const exits = room.exits.map(exit => {
      const connection = exit.connection;
      if (!sameId(connection.targetRoomId, from.roomId) || !sameId(connection.targetEntranceId, from.binding.endpointId)) return exit;
      roomChanged = true;
      return { ...exit, connection: { ...connection,
        ...(to ? { targetRoomId: to.roomId, targetEntranceId: to.binding.endpointId }
          : { enabled: false, targetRoomId: null, targetEntranceId: null }) } };
    });
    changed ||= roomChanged;
    return roomChanged ? { ...room, exits } : room;
  });
  const start = world.start && sameId(world.start.roomId, from.roomId) && sameId(world.start.entranceId, from.binding.endpointId)
    ? to ? { roomId: to.roomId, entranceId: to.binding.endpointId } : null : world.start;
  return changed || start !== world.start ? { ...world, rooms, start } : world;
}

function newEndpoint(binding: RoomTransitionBinding, name: string, previous?: WorldEndpoint): WorldEndpoint {
  const arrival = previous ? { preservePlayerDepth: previous.preservePlayerDepth, overrideFacing: previous.overrideFacing,
    faceRight: previous.faceRight, maximumPlacementAdjustmentCm: previous.maximumPlacementAdjustmentCm }
    : { preservePlayerDepth: true, overrideFacing: false, faceRight: true, maximumPlacementAdjustmentCm: 50 };
  const point = { id: binding.endpointId, name, ...arrival };
  return binding.kind === "entrance" ? point : { ...point, connection: { enabled: false, targetRoomId: null,
    targetEntranceId: null, type: "Passage", requiredTags: [], blockedTags: [], requiredAbilities: [], fadeDuration: .8 } };
}

/** Reconcile one editor transaction. Only prior bindings authorize removal; unbound manual points stay intact. */
export function reconcileRoomTransitions(previous: MapDocument, proposed: MapDocument): MapDocument {
  const before = inventory(previous);
  let next = cleanIneligibleBindings(proposed);
  let after = inventory(next);
  const previousById = new Map(before.map(binding => [key(binding.binding.endpointId), binding]));
  // A graph-side deletion is authoritative. Detach its drawing binding rather than resurrecting the point.
  const deleted = after.filter(binding => {
    const old = previousById.get(key(binding.binding.endpointId));
    return old && old.binding.kind === binding.binding.kind && sameId(old.roomId, binding.roomId)
      && endpoint(previous.world, old) && !endpoint(next.world, binding);
  });
  if (deleted.length) {
    next = { ...next, items: next.items.map(item => deleted.filter(binding => binding.itemId === item.id)
      .reduce((current, binding) => withBinding(current, null, binding.sideIndex), item)) };
    after = inventory(next);
  }
  if (!before.length && !after.length) return next;
  const afterById = new Map(after.map(binding => [key(binding.binding.endpointId), binding]));
  const inputWorld = next.world;
  let world = inputWorld;
  const entranceChanges: { from: BoundTransition; to?: BoundTransition }[] = [];
  for (const old of before) {
    const current = afterById.get(key(old.binding.endpointId));
    if (current && current.binding.kind === old.binding.kind && sameId(current.roomId, old.roomId)) continue;
    world = updateRoom(world, old.roomId, room => {
      if (old.binding.kind === "entrance") {
        const entrances = room.entrances.filter(point => !sameId(point.id, old.binding.endpointId));
        return entrances.length === room.entrances.length ? room : { ...room, entrances };
      }
      const exits = room.exits.filter(point => !sameId(point.id, old.binding.endpointId));
      return exits.length === room.exits.length ? room : { ...room, exits };
    });
    if (old.binding.kind === "entrance") entranceChanges.push({ from: old, to: current?.binding.kind === "entrance" ? current : undefined });
  }
  const names = new Map<string, string>();
  for (const binding of after) {
    const old = previousById.get(key(binding.binding.endpointId));
    const sameRoleAndOwner = old && old.binding.kind === binding.binding.kind && sameId(old.roomId, binding.roomId);
    if (!sameRoleAndOwner && endpoint(previous.world, binding))
      throw new Error("Нельзя привязать уже существующую ручную точку. Создайте отдельный переход для рисунка.");
    const item = next.items.find(item => item.id === binding.itemId)!;
    const previousItem = previous.items.find(item => item.id === binding.itemId);
    const oldPoint = old ? endpoint(inputWorld, old) ?? endpoint(previous.world, old) : undefined;
    const currentPoint = endpoint(world, binding);
    let point = currentPoint ?? (old && old.binding.kind === binding.binding.kind && oldPoint ? oldPoint : undefined);
    const defaultName = binding.sideIndex === undefined ? item.label : `${binding.binding.kind === "entrance" ? "Вход" : "Выход"} · сторона ${binding.sideIndex + 1}`;
    if (!point) point = newEndpoint(binding.binding, oldPoint?.name ?? defaultName, oldPoint);
    if (binding.sideIndex === undefined) {
      const name = !old || item.label !== previousItem?.label ? item.label : point.name;
      if (point.name !== name) point = { ...point, name };
      names.set(item.id, name);
    }
    const nextPoint = point;
    world = updateRoom(world, binding.roomId, room => {
      if (binding.binding.kind === "entrance") {
        const existing = room.entrances.find(candidate => sameId(candidate.id, binding.binding.endpointId));
        if (existing === nextPoint) return room;
        return { ...room, entrances: existing ? room.entrances.map(candidate => candidate === existing ? nextPoint as WorldEntrance : candidate)
          : [...room.entrances, nextPoint as WorldEntrance] };
      }
      const existing = room.exits.find(candidate => sameId(candidate.id, binding.binding.endpointId));
      if (existing === nextPoint) return room;
      return { ...room, exits: existing ? room.exits.map(candidate => candidate === existing ? nextPoint as WorldExit : candidate)
        : [...room.exits, nextPoint as WorldExit] };
    });
  }
  // Reconnect after adding moved exits too: several markers may change rooms in the same transaction.
  for (const change of entranceChanges) world = redirectEntrance(world, change.from, change.to);
  let renamed = false;
  const items = next.items.map(item => {
    const name = names.get(item.id);
    if (name === undefined || name === item.label) return item;
    renamed = true;
    return { ...item, label: name };
  });
  return world !== next.world || renamed ? { ...next, world, items: renamed ? items : next.items } : next;
}

/** Explicit assignment is the only operation here that creates a GUID. */
export function assignRoomTransition(document: MapDocument, itemId: string, kind: RoomTransitionKind, sideIndex?: number): MapDocument {
  const item = document.items.find(item => item.id === itemId);
  if (!item || (sideIndex === undefined ? item.kind !== "transition" : !eligibleSide(item, sideIndex)))
    throw new Error("Выберите маркер перехода или сторону комнаты «Дверь»/«Проход».");
  if (!getRoomTransitionOwner(document, item)) throw new Error("Сначала выберите комнату для перехода.");
  const old = getRoomTransitionBinding(item, sideIndex);
  const binding: RoomTransitionBinding = { kind, endpointId: old?.endpointId ?? crypto.randomUUID() };
  const updated = withBinding(item, binding, sideIndex);
  return reconcileRoomTransitions(document, { ...document, items: document.items.map(current => current.id === itemId ? updated : current) });
}

export function removeRoomTransition(document: MapDocument, itemId: string, sideIndex?: number): MapDocument {
  const item = document.items.find(item => item.id === itemId);
  if (!item || !getRoomTransitionBinding(item, sideIndex)) return document;
  return reconcileRoomTransitions(document, { ...document, items: document.items.map(current => current.id === itemId ? withBinding(current, null, sideIndex) : current) });
}

/** Topology changes retain one source pin, never duplicate its identity onto several edges. */
export function splitSideTransitions(item: PlacedItem, sideIndex: number): (RoomTransitionBinding | null)[] | undefined {
  if (!item.sideTransitions) return undefined;
  const sides = [...item.sideTransitions];
  sides.splice(sideIndex, 1, sides[sideIndex] ?? null, null);
  return sides;
}

export function extrudeSideTransitions(item: PlacedItem, sideIndex: number): (RoomTransitionBinding | null)[] | undefined {
  if (!item.sideTransitions) return undefined;
  const sides = [...item.sideTransitions];
  sides.splice(sideIndex, 1, null, sides[sideIndex] ?? null, null);
  return sides;
}

export function removeVertexSideTransitions(item: PlacedItem, vertexIndex: number): (RoomTransitionBinding | null)[] | undefined {
  if (!item.sideTransitions) return undefined;
  const sides = [...item.sideTransitions];
  sides.splice(vertexIndex, 1);
  return sides;
}
