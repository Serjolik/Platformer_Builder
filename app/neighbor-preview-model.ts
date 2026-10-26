import type { MapDocument, PlacedItem, Point } from "./map-document";
import type { WorldRoom } from "./world-model";

const CELL = 32;
const sameId = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
type Portal = { endpointId: string; roomId: string; point: Point; center: Point; outward: Point; dock: Point; dockCenter: Point };
export type NeighborFragment = {
  id: string;
  roomId: string;
  roomName: string;
  endpointName: string;
  source: Point;
  anchor: Point;
  offset: Point;
  window: Point[];
  items: PlacedItem[];
  incompatibleSides: boolean;
};

export const previewPolygon = (item: PlacedItem): Point[] => (item.polygonPoints ?? [
  { x: 0, y: 0 }, { x: item.w * CELL, y: 0 }, { x: item.w * CELL, y: item.h * CELL }, { x: 0, y: item.h * CELL },
]).map(p => ({ x: p.x + item.x, y: p.y + item.y }));

function edges(points: Point[]) {
  const area = points.reduce((sum, a, i) => { const b = points[(i + 1) % points.length]; return sum + a.x * b.y - b.x * a.y; }, 0);
  return points.map((a, i) => {
    const b = points[(i + 1) % points.length], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    const sign = area >= 0 ? 1 : -1;
    return { a, b, outward: { x: sign * dy / (length || 1), y: -sign * dx / (length || 1) }, length };
  });
}

function nearestEdge(point: Point, boundary: ReturnType<typeof edges>) {
  return boundary.filter(edge => edge.length > 0).map(edge => {
    const dx = edge.b.x - edge.a.x, dy = edge.b.y - edge.a.y;
    const t = Math.max(0, Math.min(1, ((point.x - edge.a.x) * dx + (point.y - edge.a.y) * dy) / (edge.length ** 2)));
    const projection = { x: edge.a.x + dx * t, y: edge.a.y + dy * t };
    return { ...edge, projection, distance: Math.hypot(point.x - projection.x, point.y - projection.y) };
  }).sort((a, b) => a.distance - b.distance)[0];
}

function roomShape(document: MapDocument, room: WorldRoom) {
  return document.items.find(item => item.kind === "room" && item.id === room.shapeItemId);
}

function portals(document: MapDocument, room: WorldRoom): Portal[] {
  const shape = roomShape(document, room);
  if (!shape) return [];
  const boundary = edges(previewPolygon(shape));
  const result: Portal[] = [];
  document.items.forEach(item => {
    if (!sameId(item.blocking?.roomId, room.id) && item.id !== room.shapeItemId) return;
    if (item.kind === "room") {
      const itemEdges = edges(previewPolygon(item));
      item.sideTransitions?.forEach((binding, i) => {
        const edge = itemEdges[i];
        if (!binding || !edge?.length || !["opening", "door"].includes(item.sideTypes?.[i] ?? "")) return;
        const center = { x: (edge.a.x + edge.b.x) / 2, y: (edge.a.y + edge.b.y) / 2 };
        // Sideways portals share the walking surface even when their opening heights differ.
        const point = Math.abs(edge.outward.x) > Math.abs(edge.outward.y)
          ? edge.a.y > edge.b.y ? edge.a : edge.b : center;
        result.push({ endpointId: binding.endpointId, roomId: room.id, point, center, outward: edge.outward, dock: point, dockCenter: center });
      });
    }
    if (item.kind === "transition" && item.transition) {
      const point = { x: item.x + item.w * CELL / 2, y: item.y + item.h * CELL };
      const center = { x: point.x, y: item.y + item.h * CELL / 2 };
      const edge = nearestEdge(point, boundary);
      if (edge) result.push({ endpointId: item.transition.endpointId, roomId: room.id, point, center,
        outward: edge.outward, dock: edge.projection,
        dockCenter: { x: center.x + edge.projection.x - point.x, y: center.y + edge.projection.y - point.y } });
    }
  });
  return result;
}

function fragmentItems(document: MapDocument, room: WorldRoom) {
  const visible = new Set(document.layers.filter(layer => layer.visible).map(layer => layer.id));
  return document.items.filter(item => (item.layerId === undefined || visible.has(item.layerId))
    && (item.id === room.shapeItemId || sameId(item.blocking?.roomId, room.id)
      || !item.blocking?.roomId && item.attachedRoomId === room.shapeItemId)
    && !["note", "comment", "transition"].includes(item.kind));
}

/** Read-only alignment of physical portals. Graph coordinates never participate. */
export function getNeighborFragments(document: MapDocument, roomId: string): NeighborFragment[] {
  const room = document.world.rooms.find(candidate => sameId(candidate.id, roomId));
  if (!room || !roomShape(document, room)) return [];
  const allPortals = new Map(document.world.rooms.map(candidate => [candidate.id.toLowerCase(), portals(document, candidate)]));
  const seen = new Set<string>();
  const result: NeighborFragment[] = [];
  for (const fromRoom of document.world.rooms) for (const exit of fromRoom.exits) {
    const link = exit.connection;
    if (!link.enabled || !link.targetRoomId || !link.targetEntranceId) continue;
    const toRoom = document.world.rooms.find(candidate => sameId(candidate.id, link.targetRoomId));
    if (!toRoom || sameId(fromRoom.id, toRoom.id)) continue;
    const outgoing = sameId(fromRoom.id, room.id);
    if (!outgoing && !sameId(toRoom.id, room.id)) continue;
    const sourceRoom = outgoing ? fromRoom : toRoom, neighborRoom = outgoing ? toRoom : fromRoom;
    const sourceId = outgoing ? exit.id : link.targetEntranceId, targetId = outgoing ? link.targetEntranceId : exit.id;
    const source = allPortals.get(sourceRoom.id.toLowerCase())?.find(p => sameId(p.endpointId, sourceId));
    const target = allPortals.get(neighborRoom.id.toLowerCase())?.find(p => sameId(p.endpointId, targetId));
    if (!source || !target) continue;
    // Reciprocal graph links may use separate entrance/exit IDs at the same physical opening.
    const identity = `${neighborRoom.id.toLowerCase()}:${source.point.x},${source.point.y}:${target.point.x},${target.point.y}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const n = source.outward, t = { x: -n.y, y: n.x }, depth = 10 * CELL, halfSpan = 6 * CELL;
    const corner = (distance: number, lateral: number) => ({
      x: source.dockCenter.x + n.x * distance + t.x * lateral,
      y: source.dockCenter.y + n.y * distance + t.y * lateral,
    });
    const endpointName = [...sourceRoom.entrances, ...sourceRoom.exits].find(endpoint => sameId(endpoint.id, sourceId))?.name ?? "Переход";
    result.push({ id: identity, roomId: neighborRoom.id, roomName: neighborRoom.name, endpointName,
      source: source.point, anchor: source.dock,
      offset: { x: source.dock.x - target.point.x, y: source.dock.y - target.point.y },
      window: [corner(0, -halfSpan), corner(depth, -halfSpan), corner(depth, halfSpan), corner(0, halfSpan)],
      items: fragmentItems(document, neighborRoom), incompatibleSides: n.x * target.outward.x + n.y * target.outward.y > -.75 });
  }
  return result;
}
