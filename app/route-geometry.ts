import type { MapDocument } from "./map-document";

/** Boundary normalization can move the shape origin without moving its contents. */
export function preserveRoutesDuringBoundaryEdit(previous: MapDocument, proposed: MapDocument, shapeId: string): MapDocument {
  const before = previous.items.find(item => item.id === shapeId);
  const after = proposed.items.find(item => item.id === shapeId);
  if (before?.kind !== "room" || after?.kind !== "room" || !proposed.routes?.length) return proposed;
  const dx = before.x - after.x, dy = before.y - after.y;
  if (!dx && !dy) return proposed;
  const owners = new Set(proposed.world.rooms.filter(room => room.shapeItemId === shapeId).map(room => room.id));
  if (!proposed.routes.some(route => owners.has(route.roomId))) return proposed;
  return { ...proposed, routes: proposed.routes.map(route => owners.has(route.roomId)
    ? { ...route, points: route.points.map(point => ({ x: point.x + dx, y: point.y + dy })) } : route) };
}
