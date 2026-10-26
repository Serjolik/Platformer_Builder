/** Read-only layout audit. Checks drawing geometry, not movement or combat simulation. */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { validateDocument, getItemPolygonPixels } from "./model-tools.mjs";

const epsilon = 1e-6;
const idKey = value => value?.toLowerCase();
const box = item => ({ left: item.x, top: item.y, right: item.x + item.w * 32, bottom: item.y + item.h * 32 });
const intersect = (a, b) => {
  const result = { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) };
  return result.right - result.left > epsilon && result.bottom - result.top > epsilon ? result : null;
};

/** Gates apply in both directions because the constructor defines each connection as bidirectional. */
export function reachableWith(world, { abilities = [], tags = [] } = {}) {
  const abilitySet = new Set(abilities), tagSet = new Set(tags);
  const rooms = new Map(world.rooms.map(room => [idKey(room.id), room]));
  const adjacent = new Map(world.rooms.map(room => [idKey(room.id), new Set()]));
  for (const room of world.rooms) for (const exit of room.exits) {
    const link = exit.connection, target = rooms.get(idKey(link.targetRoomId));
    if (!link.enabled || !target || !target.entrances.some(value => idKey(value.id) === idKey(link.targetEntranceId))) continue;
    if (link.requiredAbilities.some(value => !abilitySet.has(value)) || link.requiredTags.some(value => !tagSet.has(value))
      || link.blockedTags.some(value => tagSet.has(value))) continue;
    adjacent.get(idKey(room.id)).add(idKey(target.id));
    adjacent.get(idKey(target.id)).add(idKey(room.id));
  }
  const visited = new Set(), startId = idKey(world.start?.roomId);
  const queue = rooms.has(startId) ? [startId] : [];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of adjacent.get(current)) if (!visited.has(next)) queue.push(next);
  }
  return world.rooms.filter(room => visited.has(idKey(room.id))).map(room => ({ id: room.id, name: room.name }));
}

function coversLanding(solids, landing) {
  const intervals = solids.filter(({ bounds }) => Math.abs(bounds.top - landing.bottom) <= epsilon)
    .map(({ bounds }) => [Math.max(bounds.left, landing.left), Math.min(bounds.right, landing.right)])
    .filter(([left, right]) => right > left + epsilon).sort((a, b) => a[0] - b[0]);
  let coveredTo = landing.left;
  for (const [left, right] of intervals) {
    if (left > coveredTo + epsilon) return false;
    coveredTo = Math.max(coveredTo, right);
    if (coveredTo >= landing.right - epsilon) return true;
  }
  return false;
}

export function checkLayout(input, { portalLandingCells = 3 } = {}) {
  const official = validateDocument(input);
  const errors = [...official.errors], warnings = [];
  const report = { ok: false, officialValidation: { ok: official.ok, errors: official.errors.length, warnings: official.warnings.length },
    errors, warnings, reachability: null, portals: [], ladderIntersections: [], checkedLadders: 0 };
  if (!official.document) return report;
  const document = official.document;
  const roomById = new Map(document.world.rooms.map(room => [idKey(room.id), room]));
  const noAbilities = reachableWith(document.world), dash = reachableWith(document.world, { abilities: ["Dash"] });
  const noAbilityIds = new Set(noAbilities.map(room => room.id));
  report.reachability = { noAbilities, dash, addedByDash: dash.filter(room => !noAbilityIds.has(room.id)) };
  const solids = document.items.filter(item => item.blocking?.mode === "solid").flatMap(item => {
    if (item.polygonPoints) {
      warnings.push({ scope: "layout", message: "Nonrectangular solid skipped by the rectangle-only clearance audit.", itemId: item.id });
      return [];
    }
    return [{ item, bounds: box(item) }];
  });
  const solidsFor = roomId => solids.filter(({ item }) => idKey(item.blocking.roomId) === idKey(roomId));
  const cellsRelativeToRoom = (rectangle, room) => {
    const shape = document.items.find(item => item.id === room?.shapeItemId);
    const x = shape?.x ?? 0, y = shape?.y ?? 0;
    return { x: (rectangle.left - x) / 32, y: (rectangle.top - y) / 32,
      w: (rectangle.right - rectangle.left) / 32, h: (rectangle.bottom - rectangle.top) / 32 };
  };
  for (const item of document.items.filter(value => value.kind === "ladder")) {
    report.checkedLadders++;
    const bounds = box(item), room = roomById.get(idKey(item.blocking?.roomId));
    for (const solid of solidsFor(item.blocking?.roomId)) {
      const overlap = intersect(bounds, solid.bounds);
      if (!overlap) continue;
      const bottomSupport = solid.bounds.bottom >= bounds.bottom - epsilon
        && Math.abs(overlap.bottom - bounds.bottom) <= epsilon;
      const result = { roomName: room?.name, ladderId: item.id, solidId: solid.item.id,
        solidLabel: solid.item.label, kind: bottomSupport ? "bottom-support" : "interior-obstruction",
        overlapCells: cellsRelativeToRoom(overlap, room) };
      report.ladderIntersections.push(result);
      if (!bottomSupport) errors.push({ scope: "ladder", message: "Solid intersects the ladder above its bottom support.", ...result });
    }
  }
  for (const room of document.world.rooms) {
    const shape = document.items.find(item => item.id === room.shapeItemId);
    if (!shape) continue;
    const points = getItemPolygonPixels(shape), bounds = box(shape), roomSolids = solidsFor(room.id);
    for (let index = 0; index < points.length; index++) {
      const binding = shape.sideTransitions?.[index];
      if (!binding) continue;
      const from = points[index], to = points[(index + 1) % points.length];
      const endpoint = room[binding.kind === "entrance" ? "entrances" : "exits"].find(value => idKey(value.id) === idKey(binding.endpointId));
      const base = { roomName: room.name, endpointName: endpoint?.name, endpointId: binding.endpointId, sideIndex: index };
      if (Math.abs(from.x - to.x) > epsilon || (Math.abs(from.x - bounds.left) > epsilon && Math.abs(from.x - bounds.right) > epsilon)) {
        warnings.push({ scope: "portal", message: "Clearance audit supports portals on exterior left/right vertical walls only.", ...base });
        continue;
      }
      const leftSide = Math.abs(from.x - bounds.left) <= epsilon;
      const landing = { left: leftSide ? from.x : from.x - portalLandingCells * 32,
        right: leftSide ? from.x + portalLandingCells * 32 : from.x,
        top: Math.min(from.y, to.y), bottom: Math.max(from.y, to.y) };
      const floorSupported = coversLanding(roomSolids, landing);
      const obstructions = roomSolids.filter(solid => intersect(solid.bounds, landing)).map(solid => solid.item.id);
      const portal = { ...base, openingHeightCells: (landing.bottom - landing.top) / 32,
        landingCells: portalLandingCells, floorSupported, clearHeadroom: obstructions.length === 0, obstructions };
      report.portals.push(portal);
      if (!floorSupported) errors.push({ scope: "portal-floor", message: "Portal lacks a continuous solid landing at the opening's lower edge.", ...base });
      if (obstructions.length) errors.push({ scope: "portal-headroom", message: "Solid geometry blocks the portal opening or inward landing.", ...base, obstructions });
    }
  }
  report.ok = errors.length === 0;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2] ?? new URL("../Затихший узел — полный проект.json", import.meta.url);
  const report = checkLayout(JSON.parse(await readFile(file, "utf8")));
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}
